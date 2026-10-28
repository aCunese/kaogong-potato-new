import { validateStudyExtensions } from '../src/utils/studyExtensions';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, getCurrentGenerationId, getAttachmentsDir } from './db';
import {
  extractMediaIdsFromState,
  extractMediaIdsFromStateJson,
  parseMediaRef,
  MEDIA_ID_RE,
  MAX_FILE_SIZE_BYTES,
  detectImageMime,
} from './media';
export { parseMediaRef, MEDIA_ID_RE };
import {
  pruneWorkspaceHistory,
  pruneSyncIdempotency,
} from './retention';
import { AppState, PlanType, isStudySubjectForType } from '../src/types';
import {
  createSeedState,
  createSeedBooks,
  createSeedCourses,
  createSeedLibrary,
} from '../src/utils/seedFactory';

export interface WorkspaceRow {
  user_id: string;
  revision: number;
  generation_id: string;
  state_json: string;
  schema_version: number;
  seed_version?: number;
  init_choice?: string | null;
  updated_at: string;
}

/** 空资料库一次性初始化选择（服务端持久化，R10） */
export type InitChoice = 'default' | 'blank';

export interface WorkspaceGetResponse {
  ok: boolean;
  hasCloudData: boolean;
  revision: number;
  generationId: string;
  snapshotGenerationId?: string;
  schemaVersion: number;
  seedVersion?: number;
  updatedAt?: string;
  state: AppState | null;
  /** 云端完整 state_json 的 sha256（客户端用于证明拿到的是当前网络内容，不做本地信任推断） */
  contentHash: string | null;
  /** 是否需要服务端持久化的一次性空库初始化选择 */
  needsInitChoice: boolean;
  /** 已持久化的初始化选择；未选择过为 null（'default' 也代表已由注册事务写入官方种子） */
  initChoice: InitChoice | null;
}

// ----------------------------------------------------------------------
// R06 / 契约常量：图片引用形式与显式上界（绝不允许无上限）
// ----------------------------------------------------------------------

/** WrongRecord.image 允许的旧版内联 data URL 最大字符数（3,000,000） */
export const MAX_WRONG_IMAGE_DATA_URL_CHARS = 3_000_000;
/** profile.avatar 允许的旧版内联 data URL 最大字符数（2,000,000） */
export const MAX_AVATAR_DATA_URL_CHARS = 2_000_000;
/** 旧版 https 图片地址最大字符数 */
export const MAX_LEGACY_HTTPS_URL_CHARS = 512;
/** 单次同步中允许引用的不重复媒体 ID 上限（防大规模引用探测 DoS） */
export const MAX_UNIQUE_MEDIA_REFS = 5000;

/** R18：工作区序列化 JSON 字节上限（12 MiB），超出返回结构化 413 WORKSPACE_TOO_LARGE */
export const MAX_WORKSPACE_PAYLOAD_BYTES = 12 * 1024 * 1024;

/** 各类字符串字段长度上限（R18，防单字段超大字符串耗尽磁盘/内存） */
export const WORKSPACE_STRING_LIMITS = {
  id: 128,
  bookName: 120,
  courseName: 120,
  libraryName: 120,
  planName: 200,
  note: 2000,
  countdownName: 40,
  profileName: 64,
  username: 64,
  url: 2048,
  storagePath: 256,
  brandingPath: 256,
} as const;

const VALID_SUBJECTS = new Set(['常识判断', '言语理解', '数量关系', '判断推理', '资料分析', '政治理论', '申论', '面试']);
const VALID_PLAN_TYPES = new Set<string>(['book', 'course', 'custom']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSE_RE = /^pose-[0-7]$/;
const BRANDING_PATH_RE = /^\/branding\/[A-Za-z0-9._\-\/]+$/;
const LEGACY_IMAGE_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const ALLOWED_ROOT_KEYS = new Set(['profile', 'books', 'courses', 'library', 'plans', 'records', 'wrong', 'countdowns', 'version', 'todos', 'timerSessions']);

/** 根数组字段的安全容量上限（防范存储炸弹与内存耗尽 DoS） */
const MAX_ARRAY_LIMITS: Record<string, number> = {
  books: 500,
  courses: 500,
  library: 1000,
  plans: 5000,
  records: 20000,
  wrong: 5000,
  countdowns: 100,
};

function isNonNegativeNumber(val: any): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

function isNonEmptyString(val: any, maxLen: number): boolean {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

function isOptionalString(val: any, maxLen: number): boolean {
  return val === undefined || val === null || (typeof val === 'string' && val.length <= maxLen);
}

interface ImageRefResult {
  ok: boolean;
  message?: string;
  mediaId?: string;
}

/**
 * 校验单个图片引用（R06 统一契约）。
 * 允许形式：
 *  - ''（无图片）
 *  - 内置姿势 /^pose-[0-7]$/
 *  - /branding/ 下的静态资源路径
 *  - 已确认媒体引用 /api/media/<id> 或 media:<id>（归属校验在 validateMediaRefsOwnership 单独执行）
 *  - 旧版内联 data URL（仅 base64 的 jpeg/jpg/png/webp，且有显式长度上限）
 *  - 旧版 https 地址（≤ 512 字符）
 * 其它形式（blob:、file:、非图片 data:、未知相对路径）一律拒绝，绝不放任无上限字符串。
 */
function validateImageRef(value: any, maxDataUrlChars: number, field: string): ImageRefResult {
  if (typeof value !== 'string') {
    return { ok: false, message: `${field} 必须为字符串` };
  }
  if (value === '') return { ok: true };
  if (POSE_RE.test(value)) return { ok: true };

  if (value.startsWith('/branding/')) {
    if (value.length > WORKSPACE_STRING_LIMITS.brandingPath || !BRANDING_PATH_RE.test(value) || value.includes('..')) {
      return { ok: false, message: `${field} 的 /branding/ 静态路径不合法（不允许路径穿越，长度上限 ${WORKSPACE_STRING_LIMITS.brandingPath}）` };
    }
    return { ok: true };
  }

  const mediaId = parseMediaRef(value);
  if (mediaId) return { ok: true, mediaId };

  if (value.startsWith('data:')) {
    if (!LEGACY_IMAGE_DATA_URL_RE.test(value)) {
      return { ok: false, message: `${field} 仅支持 data:image/(jpeg|jpg|png|webp);base64 形式的旧版内联图片` };
    }
    if (value.length > maxDataUrlChars) {
      return { ok: false, message: `${field} 旧版内联图片超过上限 (${maxDataUrlChars} 字符)，请改用 /api/media 上传后的稳定引用` };
    }
    return { ok: true };
  }

  if (value.startsWith('blob:') || value.startsWith('file:')) {
    return { ok: false, message: `${field} 不允许本机临时引用 (${value.slice(0, 8)}...)，请先上传至媒体接口获取稳定引用` };
  }

  if (value.startsWith('https://')) {
    if (value.length > MAX_LEGACY_HTTPS_URL_CHARS) {
      return { ok: false, message: `${field} 的旧版 https 图片地址超过上限 (${MAX_LEGACY_HTTPS_URL_CHARS} 字符)` };
    }
    return { ok: true };
  }

  return { ok: false, message: `${field} 不是受支持的图片引用形式（仅支持 ''、pose-[0-7]、/branding/ 静态路径、/api/media/<id> 或 media:<id> 媒体引用、旧版 data URL、旧版 https 地址）` };
}

/** 从 library 中尝试推导历史计划缺失的 type 字段（旧版快照兼容） */
function derivePlanType(library: any[], plan: any): PlanType | null {
  if (!Array.isArray(library)) return null;
  const planLibraryId = typeof plan.libraryId === 'string' ? plan.libraryId : '';
  const planSourceId = typeof plan.sourceId === 'string' ? plan.sourceId : '';
  for (const item of library) {
    if (!item || typeof item !== 'object') continue;
    const itemId = typeof item.id === 'string' ? item.id : '';
    const itemSourceId = typeof item.sourceId === 'string' ? item.sourceId : '';
    const hit = (planLibraryId && itemId === planLibraryId) || (planSourceId && itemSourceId === planSourceId);
    if (hit && typeof item.type === 'string' && VALID_PLAN_TYPES.has(item.type)) {
      return item.type as PlanType;
    }
  }
  return null;
}

export interface WorkspaceValidationResult {
  valid: boolean;
  message?: string;
  /** 结构校验通过后收集到的待归属校验媒体 ID（去重前） */
  mediaRefs?: string[];
}

/**
 * R18：工作区全字段递归强类型校验。
 * - state.version 支持 3、4，须与传入 schemaVersion 一致（旧版缺失值兼容）；
 * - plan.type / record.type 出现时必须是合法枚举（缺失的历史字段允许兼容，但非法值严格拒绝）；
 * - timerStart / accumulatedMs / plannedMinutes / actualMinutes / targetMinutes 出现时必须是有限非负数；
 * - 所有日期为 YYYY-MM-DD（倒计时允许 '' 表示未设置）；
 * - 所有字符串有明确长度上限，所有数字必须 Number.isFinite；
 * - R06：wrong[].image / wrong[].images / profile.avatar 走统一图片引用契约。
 */
export function validateWorkspacePayload(state: any, schemaVersion: any): WorkspaceValidationResult {
  if (![3, 4, 5].includes(schemaVersion)) {
    return { valid: false, message: `不支持的工作区 schema 版本: ${schemaVersion}，仅支持版本 3、4、5` };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, message: '工作区 state 必须为有效 JSON 对象，不能为字符串、数组或空值' };
  }
  // Preserve legacy version-3 snapshots; version-4 extensions are validated below.
  if (state.version !== undefined) {
    if (typeof state.version !== 'number' || !Number.isFinite(state.version) || (![3, 4, 5].includes(state.version))) {
      return { valid: false, message: `state.version 必须为数字 3、4 或 5（实际: ${JSON.stringify(state.version)}）` };
    }
  }

  if ((state.version !== undefined && state.version !== schemaVersion) || (schemaVersion >= 4 && state.version !== schemaVersion)) return { valid: false, message: '工作区内容版本与同步协议不一致，请更新客户端。' };
  const extensionError = validateStudyExtensions(state);
  if (extensionError) return { valid: false, message: extensionError };

  // 防御未知大对象挂载与内存爆炸 DoS (Memory Exhaustion)
  for (const key of Object.keys(state)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      return { valid: false, message: `工作区 state 包含不支持的未知扩展属性: ${key}` };
    }
  }

  const mediaRefs: string[] = [];

  // 1. Profile 校验
  if (!state.profile || typeof state.profile !== 'object' || Array.isArray(state.profile)) {
    return { valid: false, message: '工作区缺少有效的 profile 个人信息配置' };
  }
  if (typeof state.profile.name !== 'string' || state.profile.name.length > WORKSPACE_STRING_LIMITS.profileName) {
    return { valid: false, message: `profile.name 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.profileName}` };
  }
  if (typeof state.profile.username !== 'string' || state.profile.username.length > WORKSPACE_STRING_LIMITS.username) {
    return { valid: false, message: `profile.username 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.username}` };
  }
  if (state.profile.avatar !== undefined && state.profile.avatar !== null) {
    const avatarCheck = validateImageRef(state.profile.avatar, MAX_AVATAR_DATA_URL_CHARS, 'profile.avatar');
    if (!avatarCheck.ok) return { valid: false, message: avatarCheck.message! };
    if (avatarCheck.mediaId) mediaRefs.push(avatarCheck.mediaId);
  }

  // 2. 核心数组存在性与安全容量上限校验
  for (const field of Object.keys(MAX_ARRAY_LIMITS)) {
    if (!Array.isArray(state[field])) {
      return { valid: false, message: `工作区数据缺少必需的数组字段: ${field}` };
    }
    if (state[field].length > MAX_ARRAY_LIMITS[field]) {
      return { valid: false, message: `工作区 ${field} 数组条目数 (${state[field].length}) 超出系统安全上限 (${MAX_ARRAY_LIMITS[field]})` };
    }
  }

  // 3. Books 详细项类型校验
  for (let i = 0; i < state.books.length; i++) {
    const b = state.books[i];
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return { valid: false, message: `books[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(b.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `books[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (!isNonEmptyString(b.name, WORKSPACE_STRING_LIMITS.bookName)) {
      return { valid: false, message: `books[${i}].name 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.bookName}` };
    }
    if (typeof b.subject !== 'string' || !VALID_SUBJECTS.has(b.subject)) {
      return { valid: false, message: `books[${i}].subject「${b.subject}」不是有效的科目` };
    }
    if (!isNonNegativeNumber(b.total) || !isNonNegativeNumber(b.pages) || !isNonNegativeNumber(b.done) || !isNonNegativeNumber(b.errors) || !isNonNegativeNumber(b.minutes)) {
      return { valid: false, message: `books[${i}] 题数/页数/进度/用时必须为非负有效数值` };
    }
  }

  // 4. Courses 详细项校验
  for (let i = 0; i < state.courses.length; i++) {
    const c = state.courses[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return { valid: false, message: `courses[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(c.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `courses[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (!isNonEmptyString(c.name, WORKSPACE_STRING_LIMITS.courseName)) {
      return { valid: false, message: `courses[${i}].name 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.courseName}` };
    }
    if (typeof c.subject !== 'string' || !VALID_SUBJECTS.has(c.subject)) {
      return { valid: false, message: `courses[${i}].subject「${c.subject}」不是有效的科目` };
    }
    if (!isNonNegativeNumber(c.totalLessons) || !isNonNegativeNumber(c.completedLessons) || !isNonNegativeNumber(c.minutes)) {
      return { valid: false, message: `courses[${i}] 课时与学习时长必须为非负有效数值` };
    }
    if (!isOptionalString(c.url, WORKSPACE_STRING_LIMITS.url)) {
      return { valid: false, message: `courses[${i}].url 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.url}` };
    }
  }

  // 5. Library 校验
  for (let i = 0; i < state.library.length; i++) {
    const item = state.library[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, message: `library[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(item.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `library[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (typeof item.type !== 'string' || !VALID_PLAN_TYPES.has(item.type)) {
      return { valid: false, message: `library[${i}].type「${item.type}」必须为 book/course/custom` };
    }
    if (!isNonEmptyString(item.name, WORKSPACE_STRING_LIMITS.libraryName)) {
      return { valid: false, message: `library[${i}].name 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.libraryName}` };
    }
    if (!isStudySubjectForType(item.subject, item.type)) {
      return { valid: false, message: `library[${i}].subject「${item.subject}」不是有效的科目` };
    }
    if (!isNonNegativeNumber(item.defaultMinutes)) {
      return { valid: false, message: `library[${i}].defaultMinutes 必须为非负有效数值` };
    }
    if (!isOptionalString(item.sourceId, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `library[${i}].sourceId 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
  }

  // 6. Plans 校验（R18：type 枚举、timerStart/accumulatedMs 等数值字段严格校验）
  for (let i = 0; i < state.plans.length; i++) {
    const p = state.plans[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { valid: false, message: `plans[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(p.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `plans[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    const name = p.name || p.title;
    if (typeof name !== 'string' || !name.trim() || name.length > WORKSPACE_STRING_LIMITS.planName) {
      return { valid: false, message: `plans[${i}] name/title 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.planName}` };
    }
    if (typeof p.date !== 'string' || !DATE_RE.test(p.date)) {
      return { valid: false, message: `plans[${i}].date「${p.date}」必须为 YYYY-MM-DD 格式` };
    }
    if (p.type !== undefined && p.type !== null) {
      if (typeof p.type !== 'string' || !VALID_PLAN_TYPES.has(p.type)) {
        return { valid: false, message: `plans[${i}].type「${p.type}」必须为 book/course/custom` };
      }
    } else if (!derivePlanType(state.library, p)) {
      // 旧版快照可缺失 type（无法从 library 推导时按历史数据兼容放行，非法显式 type 已在上方拒绝）
    }
    const planType = p.type ?? derivePlanType(state.library, p);
    if (!isStudySubjectForType(p.subject, planType)) {
      return { valid: false, message: `plans[${i}].subject「${p.subject}」不是有效科目` };
    }
    for (const field of ['plannedMinutes', 'targetMinutes', 'actualMinutes', 'accumulatedMs', 'timerStart']) {
      if (p[field] !== undefined && !isNonNegativeNumber(p[field])) {
        return { valid: false, message: `plans[${i}].${field} 必须为有限非负数字` };
      }
    }
    if (typeof p.done !== 'boolean') {
      return { valid: false, message: `plans[${i}].done 必须为布尔值` };
    }
    for (const field of ['libraryId', 'sourceId', 'recordId']) {
      if (!isOptionalString(p[field], WORKSPACE_STRING_LIMITS.id)) {
        return { valid: false, message: `plans[${i}].${field} 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
      }
    }
  }

  // 7. Records 校验
  for (let i = 0; i < state.records.length; i++) {
    const r = state.records[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { valid: false, message: `records[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(r.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `records[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (typeof r.date !== 'string' || !DATE_RE.test(r.date)) {
      return { valid: false, message: `records[${i}].date「${r.date}」必须为 YYYY-MM-DD 格式` };
    }
    if (!isStudySubjectForType(r.subject, r.type)) {
      return { valid: false, message: `records[${i}].subject「${r.subject}」不是有效科目` };
    }
    if (!isNonNegativeNumber(r.minutes)) {
      return { valid: false, message: `records[${i}].minutes 必须为非负有效数值` };
    }
    for (const field of ['questions', 'errors', 'lessons']) {
      if (r[field] !== undefined && !isNonNegativeNumber(r[field])) {
        return { valid: false, message: `records[${i}].${field} 必须为有限非负数字` };
      }
    }
    if (r.type !== undefined && r.type !== null) {
      if (typeof r.type !== 'string' || !VALID_PLAN_TYPES.has(r.type)) {
        return { valid: false, message: `records[${i}].type「${r.type}」必须为 book/course/custom` };
      }
    }
    for (const field of ['planId', 'sourceId']) {
      if (!isOptionalString(r[field], WORKSPACE_STRING_LIMITS.id)) {
        return { valid: false, message: `records[${i}].${field} 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
      }
    }
  }

  // 8. Wrong 校验（R06：单字段 image 与旧版 images 数组统一契约）
  for (let i = 0; i < state.wrong.length; i++) {
    const w = state.wrong[i];
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      return { valid: false, message: `wrong[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(w.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `wrong[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (typeof w.date !== 'string' || !DATE_RE.test(w.date)) {
      return { valid: false, message: `wrong[${i}].date「${w.date}」必须为 YYYY-MM-DD 格式` };
    }
    if (!isOptionalString(w.bookId, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `wrong[${i}].bookId 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (w.note !== undefined && (typeof w.note !== 'string' || w.note.length > WORKSPACE_STRING_LIMITS.note)) {
      return { valid: false, message: `wrong[${i}].note 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.note}` };
    }
    if (!isOptionalString(w.storagePath, WORKSPACE_STRING_LIMITS.storagePath)) {
      return { valid: false, message: `wrong[${i}].storagePath 必须为字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.storagePath}` };
    }
    if (w.image !== undefined && w.image !== null) {
      const imageCheck = validateImageRef(w.image, MAX_WRONG_IMAGE_DATA_URL_CHARS, `wrong[${i}].image`);
      if (!imageCheck.ok) return { valid: false, message: imageCheck.message! };
      if (imageCheck.mediaId) mediaRefs.push(imageCheck.mediaId);
    }
    if (w.images !== undefined) {
      if (!Array.isArray(w.images)) {
        return { valid: false, message: `wrong[${i}].images 必须为数组` };
      }
      if (w.images.length > 9) {
        return { valid: false, message: `wrong[${i}].images 数量超出上限 (最多 9 张图片)` };
      }
      for (let j = 0; j < w.images.length; j++) {
        const itemCheck = validateImageRef(w.images[j], MAX_WRONG_IMAGE_DATA_URL_CHARS, `wrong[${i}].images[${j}]`);
        if (!itemCheck.ok) return { valid: false, message: itemCheck.message! };
        if (itemCheck.mediaId) mediaRefs.push(itemCheck.mediaId);
      }
    }
  }

  // 9. Countdowns 校验（date 允许 '' 表示尚未设置）
  for (let i = 0; i < state.countdowns.length; i++) {
    const cd = state.countdowns[i];
    if (!cd || typeof cd !== 'object' || Array.isArray(cd)) {
      return { valid: false, message: `countdowns[${i}] 必须为对象` };
    }
    if (!isNonEmptyString(cd.id, WORKSPACE_STRING_LIMITS.id)) {
      return { valid: false, message: `countdowns[${i}].id 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.id}` };
    }
    if (!isNonEmptyString(cd.name, WORKSPACE_STRING_LIMITS.countdownName)) {
      return { valid: false, message: `countdowns[${i}].name 必须为非空字符串且长度不超过 ${WORKSPACE_STRING_LIMITS.countdownName}` };
    }
    if (typeof cd.date !== 'string' || (cd.date !== '' && !DATE_RE.test(cd.date))) {
      return { valid: false, message: `countdowns[${i}].date「${cd.date}」必须为 YYYY-MM-DD 格式或空字符串` };
    }
  }

  return { valid: true, mediaRefs };
}

/**
 * R06：校验工作区里引用的媒体 ID 全部属于当前用户。
 * 未知或属于其它账号的引用返回 INVALID_MEDIA_REF，不再静默保存坏引用。
 */
export function validateMediaRefsOwnership(
  userId: string,
  mediaIds: string[]
): { valid: boolean; invalidRefs: string[] } {
  if (!mediaIds || mediaIds.length === 0) return { valid: true, invalidRefs: [] };

  const unique = Array.from(new Set(mediaIds));
  if (unique.length > MAX_UNIQUE_MEDIA_REFS) {
    return { valid: false, invalidRefs: unique.slice(MAX_UNIQUE_MEDIA_REFS) };
  }

  const db = getDb();
  const found = new Set<string>();
  const attachmentsDir = getAttachmentsDir();
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, filename, byte_size, sha256 FROM media_records WHERE user_id = ? AND id IN (${placeholders})`
    ).all(userId, ...chunk) as Array<{ id: string; filename: string; byte_size: number; sha256: string }>;
    for (const row of rows) {
      if (row.filename) {
        const diskPath = path.join(attachmentsDir, row.filename);
        try {
          if (fs.existsSync(diskPath)) {
            const stat = fs.statSync(diskPath);
            if (stat.size === row.byte_size && stat.size <= MAX_FILE_SIZE_BYTES) {
              const fileBytes = fs.readFileSync(diskPath);
              const fileSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
              if (fileSha === row.sha256) {
                found.add(row.id);
              }
            }
          }
        } catch {}
      }
    }
  }

  const invalidRefs = unique.filter(id => !found.has(id));
  return { valid: invalidRefs.length === 0, invalidRefs };
}

function parseStateJson(raw: string): AppState | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as AppState;
  } catch {
    return null;
  }
}

export function getStateContentHash(rawStateJson: string): string {
  return crypto.createHash('sha256').update(rawStateJson).digest('hex');
}

function normalizeInitChoice(value: unknown): InitChoice | null {
  return value === 'default' || value === 'blank' ? value : null;
}

export function getUserWorkspace(userId: string): WorkspaceGetResponse {
  const db = getDb();
  const currentGen = getCurrentGenerationId();
  const row = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(userId) as WorkspaceRow | undefined;

  if (!row) {
    return {
      ok: true,
      hasCloudData: false,
      revision: 0,
      generationId: currentGen,
      snapshotGenerationId: currentGen,
      schemaVersion: 3,
      seedVersion: 0,
      state: null,
      contentHash: null,
      needsInitChoice: false,
      initChoice: null,
    };
  }

  const parsedState = parseStateJson(row.state_json);
  const seedVersion = row.seed_version || 0;
  const initChoice = normalizeInitChoice(row.init_choice);
  const booksLen = Array.isArray(parsedState?.books) ? parsedState!.books.length : 0;
  const coursesLen = Array.isArray(parsedState?.courses) ? parsedState!.courses.length : 0;

  // R10：以服务端持久化状态判定是否需要初始化选择，绝不依赖本机 localStorage
  const needsInitChoice = seedVersion === 0 && initChoice === null && booksLen === 0 && coursesLen === 0;

  return {
    ok: true,
    hasCloudData: true,
    revision: row.revision,
    generationId: currentGen,
    snapshotGenerationId: row.generation_id,
    schemaVersion: row.schema_version,
    seedVersion,
    updatedAt: row.updated_at,
    state: parsedState,
    contentHash: getStateContentHash(row.state_json),
    needsInitChoice,
    initChoice,
  };
}

export interface SyncPushInput {
  userId: string;
  expectedRevision: number;
  expectedContentHash?: string;
  requestId: string;
  schemaVersion: number;
  generationId: string;
  state: AppState;
  reason?: string;
}

export interface SyncPushResult {
  ok: boolean;
  status: 200 | 400 | 409 | 413 | 426 | 500;
  code?: string;
  message?: string;
  revision?: number;
  updatedAt?: string;
  generationId?: string;
  serverRevision?: number;
  serverState?: AppState | null;
  idempotent?: boolean;
  /** 成功时为新写入 state_json 的 sha256；冲突时为服务端当前 state_json 的 sha256 */
  contentHash?: string | null;
  /** 冲突时服务端当前快照代际 */
  snapshotGenerationId?: string | null;
  /** 冲突时服务端当前 state_json 的 sha256（与 contentHash 相同，语义化命名） */
  serverContentHash?: string | null;
}

export function syncUserWorkspace(input: SyncPushInput): SyncPushResult {
  const db = getDb();
  const currentGen = getCurrentGenerationId();

  // 1. R18/R06 Strict Schema & State Payload Validation
  const validation = validateWorkspacePayload(input.state, input.schemaVersion);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_WORKSPACE_STATE',
      message: validation.message || '工作区数据格式校验未通过',
    };
  }

  // 2. Workspace payload byte cap (12 MiB) -> structured 413 WORKSPACE_TOO_LARGE
  const payloadString = JSON.stringify(input.state);
  const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
  if (payloadBytes > MAX_WORKSPACE_PAYLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'WORKSPACE_TOO_LARGE',
      message: `工作区数据体积 (${payloadBytes} 字节) 超出服务端上限 (${MAX_WORKSPACE_PAYLOAD_BYTES} 字节)，请压缩图片或改用 /api/media 稳定引用后重试`,
    };
  }

  // 3. R06: all media refs must belong to the current user
  if (validation.mediaRefs && validation.mediaRefs.length > 0) {
    const ownership = validateMediaRefsOwnership(input.userId, validation.mediaRefs);
    if (!ownership.valid) {
      const preview = ownership.invalidRefs.slice(0, 3).join(', ');
      return {
        ok: false,
        status: 400,
        code: 'INVALID_MEDIA_REF',
        message: `工作区引用了不存在或不属于当前账号的媒体附件: ${preview}${ownership.invalidRefs.length > 3 ? ' 等' : ''}`,
      };
    }
  }

  // 4. Strict Generation ID Guard: Non-empty & must match current server generation (Defect I)
  if (!input.generationId || typeof input.generationId !== 'string' || input.generationId !== currentGen) {
    const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(input.userId) as WorkspaceRow | undefined;
    const serverState = existing ? parseStateJson(existing.state_json) : null;
    const serverContentHash = existing ? getStateContentHash(existing.state_json) : null;
    return {
      ok: false,
      status: 409,
      code: 'GENERATION_MISMATCH',
      message: '服务器代际不匹配或发生过灾备恢复。为防止覆盖灾备数据，请重新核对云端版本。',
      generationId: currentGen,
      serverRevision: existing ? existing.revision : 0,
      serverState,
      contentHash: serverContentHash,
      serverContentHash,
      snapshotGenerationId: existing ? existing.generation_id : null,
    };
  }

  const payloadSha = crypto.createHash('sha256').update(payloadString).digest('hex');

  // 5. Check Idempotency Table: (user_id, request_id)
  const existingIdempotency = db.prepare(`
    SELECT * FROM sync_idempotency WHERE user_id = ? AND request_id = ?
  `).get(input.userId, input.requestId) as {
    user_id: string;
    request_id: string;
    expected_revision: number;
    result_revision: number;
    payload_sha256: string;
    created_at: string;
  } | undefined;

  if (existingIdempotency) {
    if (existingIdempotency.payload_sha256 !== payloadSha) {
      return {
        ok: false,
        status: 400,
        code: 'DUPLICATE_REQUEST_ID_DIFFERENT_PAYLOAD',
        message: '相同的请求 ID 提交了不同的数据内容，已拒绝处理。',
      };
    }
    // Idempotent retry: return previously recorded revision
    return {
      ok: true,
      status: 200,
      revision: existingIdempotency.result_revision,
      updatedAt: existingIdempotency.created_at,
      generationId: currentGen,
      idempotent: true,
      contentHash: existingIdempotency.payload_sha256,
    };
  }

  // 6. Execute revision check and workspace update inside a single SQLite transaction
  const executeTransaction = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(input.userId) as WorkspaceRow | undefined;
    const currentRevision = existing ? existing.revision : 0;
    const serverContentHash = existing ? getStateContentHash(existing.state_json) : null;
    const serverState = existing ? parseStateJson(existing.state_json) : null;

    if (existing && existing.schema_version >= 4 && input.schemaVersion < existing.schema_version) {
      return { downgrade: true as const };
    }

    // Check expected content hash if provided
    if (input.expectedContentHash !== undefined && input.expectedContentHash !== null) {
      if (serverContentHash !== input.expectedContentHash) {
        return {
          conflict: true as const,
          currentRevision,
          serverState,
          serverContentHash,
          snapshotGenerationId: existing ? existing.generation_id : null,
        };
      }
    }

    // Check revision
    if (currentRevision !== input.expectedRevision) {
      return {
        conflict: true as const,
        currentRevision,
        serverState,
        serverContentHash,
        snapshotGenerationId: existing ? existing.generation_id : null,
      };
    }

    const nextRevision = currentRevision + 1;
    const nowIso = new Date().toISOString();

    // Preserve old version into history if there was an existing workspace
    if (existing) {
      const historyId = `hist_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const safeReason = typeof input.reason === 'string' ? input.reason.slice(0, 100) : 'sync';
      db.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(historyId, input.userId, existing.revision, safeReason, existing.state_json, nowIso);
    }

    // Write new workspace (init_choice 不在同步路径写入，保留服务端已持久化的选择)
    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, seed_version, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        seed_version = COALESCE(workspaces.seed_version, 0),
        updated_at = excluded.updated_at
    `).run(input.userId, nextRevision, currentGen, payloadString, input.schemaVersion || 3, nowIso);

    // Record idempotency
    db.prepare(`
      INSERT INTO sync_idempotency (user_id, request_id, expected_revision, result_revision, payload_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.userId, input.requestId, input.expectedRevision, nextRevision, payloadSha, nowIso);

    // R18: bounded retention (lazy pruning only on new writes; only >7-day history is pruned)
    pruneWorkspaceHistory(input.userId, new Date(nowIso), db);
    pruneSyncIdempotency(input.userId, new Date(nowIso), db);

    return {
      conflict: false as const,
      nextRevision,
      updatedAt: nowIso,
    };
  });

  const txResult = executeTransaction();
  if ('downgrade' in txResult) return { ok: false, status: 426, code: 'CLIENT_UPDATE_REQUIRED', message: '云端已有新版待办与计时数据，请更新客户端后继续同步；本机数据已保留。' };
  if (txResult.conflict) {
    return {
      ok: false,
      status: 409,
      code: 'REVISION_CONFLICT',
      message: `云端存在更新版本（云端修订号: ${txResult.currentRevision}，本地提交期待: ${input.expectedRevision}），请拉取或合并。`,
      serverRevision: txResult.currentRevision,
      serverState: txResult.serverState,
      contentHash: txResult.serverContentHash,
      serverContentHash: txResult.serverContentHash,
      snapshotGenerationId: txResult.snapshotGenerationId,
    };
  }

  return {
    ok: true,
    status: 200,
    revision: txResult.nextRevision,
    updatedAt: txResult.updatedAt,
    generationId: currentGen,
    contentHash: payloadSha,
  };
}

// ----------------------------------------------------------------------
// R10: 服务端持久化的一次性空资料库初始化选择
// ----------------------------------------------------------------------

export interface InitChoiceInput {
  userId: string;
  choice: InitChoice;
  username: string;
  nickname: string;
}

export interface InitChoiceResult {
  ok: boolean;
  status: 200 | 400 | 413 | 500;
  code?: string;
  message?: string;
  revision?: number;
  generationId?: string;
  contentHash?: string;
  state?: AppState | null;
  seedVersion?: number;
  initChoice?: InitChoice | null;
  alreadyApplied?: boolean;
}

/** 以远程账号资料构造空白工作区（不写入前端种子，仅用于无 row 的兜底初始化） */
function createBlankStateForUser(username: string, nickname: string): AppState {
  const seed = createSeedState(username, nickname);
  return {
    ...seed,
    books: [],
    courses: [],
    library: [],
    plans: [],
    records: [],
    wrong: [],
  };
}

const STABLE_COUNTDOWNS_SEED = [
  { id: 'exam-national', name: '国考', date: '' },
  { id: 'exam-provincial', name: '省考', date: '' },
  { id: 'exam-public-service', name: '事业编', date: '' },
];

/**
 * 将官方默认资料库（14 题本 / 7 网课 / 22 事项）按稳定 seed ID 合并进既有 state：
 * - 已存在的同 ID 题本/课程/事项一律保留（进度、名称、课程链接、defaultMinutes 均不覆盖）；
 * - 自定义题本/课程/事项全部保留；
 * - 只补缺失的官方默认项；plans/records/wrong 原样保留。
 */
export function mergeDefaultSeedIntoState(existing: AppState): AppState {
  const existingBooks = Array.isArray(existing.books) ? existing.books : [];
  const existingCourses = Array.isArray(existing.courses) ? existing.courses : [];
  const existingLibrary = Array.isArray(existing.library) ? existing.library : [];
  const existingCountdowns = Array.isArray(existing.countdowns) ? existing.countdowns : [];

  const seedBooks = createSeedBooks();
  const seedCourses = createSeedCourses();
  const seedLibrary = createSeedLibrary(seedBooks, seedCourses);

  const existingBookIds = new Set(existingBooks.map(b => b && typeof b === 'object' ? (b as any).id : undefined));
  const mergedBooks = [
    ...existingBooks,
    ...seedBooks.filter(b => !existingBookIds.has(b.id)),
  ];

  const existingCourseIds = new Set(existingCourses.map(c => c && typeof c === 'object' ? (c as any).id : undefined));
  const mergedCourses = [
    ...existingCourses,
    ...seedCourses.filter(c => !existingCourseIds.has(c.id)),
  ];

  // Library：稳定 seed ID 优先使用既有条目属性（保留改名/defaultMinutes），缺失的默认项补齐；
  // 既有的自定义事项（非 seed ID）按原顺序追加，绝不丢失。
  const existingLibraryById = new Map<string, any>();
  for (const item of existingLibrary) {
    if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
      existingLibraryById.set((item as any).id, item);
    }
  }
  const seedLibraryIds = new Set(seedLibrary.map(item => item.id));
  const mergedLibrary = [
    ...seedLibrary.map(seedItem => existingLibraryById.get(seedItem.id) || seedItem),
    ...existingLibrary.filter(item => item && typeof item === 'object' && !seedLibraryIds.has((item as any).id)),
  ];

  const mergedCountdowns = [...existingCountdowns];
  const countdownIds = new Set(mergedCountdowns.map(c => c && typeof c === 'object' ? (c as any).id : undefined));
  for (const stable of STABLE_COUNTDOWNS_SEED) {
    if (!countdownIds.has(stable.id)) mergedCountdowns.push({ ...stable });
  }

  // 只重建已知根字段，不保留旧 state 上的未知扩展属性（避免旧脏数据让合并结果再次校验失败）
  return {
    profile: existing.profile,
    countdowns: mergedCountdowns,
    books: mergedBooks,
    courses: mergedCourses,
    library: mergedLibrary,
    plans: Array.isArray(existing.plans) ? existing.plans : [],
    records: Array.isArray(existing.records) ? existing.records : [],
    wrong: Array.isArray(existing.wrong) ? existing.wrong : [],
    ...(existing.todos !== undefined ? { todos: existing.todos } : {}),
    version: existing.version ?? 3,
    ...(existing.timerSessions !== undefined ? { timerSessions: existing.timerSessions } : {}),
  };
}

/**
 * 服务端持久化一次性空库初始化选择（R10）：
 * - 'default'：事务内合并官方默认资料库（保留既有自定义/进度），revision+1，seed_version=1；
 * - 'blank'：保留原状态，仅持久化选择，revision+1，seed_version=1；
 * - 幂等：已持久化选择时直接返回当前 state（alreadyApplied: true），不再二次 bump revision。
 */
export function applyWorkspaceInitChoice(input: InitChoiceInput): InitChoiceResult {
  if (input.choice !== 'default' && input.choice !== 'blank') {
    return { ok: false, status: 400, code: 'INVALID_INIT_CHOICE', message: "初始化选择必须为 'default' 或 'blank'" };
  }

  const db = getDb();
  const currentGen = getCurrentGenerationId();

  const executeTransaction = db.transaction((): InitChoiceResult => {
    const row = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(input.userId) as WorkspaceRow | undefined;
    const persistedChoice = row ? normalizeInitChoice(row.init_choice) : null;
    const seedVersion = row ? row.seed_version || 0 : 0;

    // 已持久化过选择（或已由注册事务写入官方种子）=> 幂等返回，绝不再 bump revision
    if (row && (persistedChoice !== null || seedVersion >= 1)) {
      return {
        ok: true,
        status: 200,
        alreadyApplied: true,
        revision: row.revision,
        generationId: currentGen,
        contentHash: getStateContentHash(row.state_json),
        state: parseStateJson(row.state_json),
        seedVersion,
        initChoice: persistedChoice,
      };
    }

    const existingState = row ? parseStateJson(row.state_json) : null;
    if (row && !existingState) {
      return { ok: false, status: 500, code: 'WORKSPACE_UNREADABLE', message: '云端工作区数据无法解析，无法应用初始化选择' };
    }

    let nextState: AppState;
    if (input.choice === 'default') {
      nextState = existingState
        ? mergeDefaultSeedIntoState(existingState)
        : createSeedState(input.username, input.nickname);

      const validation = validateWorkspacePayload(nextState, nextState.version || 3);
      if (!validation.valid) {
        return {
          ok: false,
          status: 400,
          code: 'INVALID_WORKSPACE_STATE',
          message: `合并默认资料库后工作区校验未通过: ${validation.message}`,
        };
      }
    } else {
      nextState = existingState || createBlankStateForUser(input.username, input.nickname);
    }

    const nextJson = JSON.stringify(nextState);
    const nextBytes = Buffer.byteLength(nextJson, 'utf8');
    if (nextBytes > MAX_WORKSPACE_PAYLOAD_BYTES) {
      return {
        ok: false,
        status: 413,
        code: 'WORKSPACE_TOO_LARGE',
        message: `工作区数据体积 (${nextBytes} 字节) 超出服务端上限 (${MAX_WORKSPACE_PAYLOAD_BYTES} 字节)`,
      };
    }

    const nowIso = new Date().toISOString();
    const currentRevision = row ? row.revision : 0;
    const nextRevision = currentRevision + 1;

    if (row) {
      const historyId = `hist_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(historyId, input.userId, currentRevision, `init_choice_${input.choice}`, row.state_json, nowIso);
    }

    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, seed_version, init_choice, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        seed_version = 1,
        init_choice = excluded.init_choice,
        updated_at = excluded.updated_at
    `).run(input.userId, nextRevision, currentGen, nextJson, nextState.version, input.choice, nowIso);

    pruneWorkspaceHistory(input.userId, new Date(nowIso), db);

    return {
      ok: true,
      status: 200,
      alreadyApplied: false,
      revision: nextRevision,
      generationId: currentGen,
      contentHash: getStateContentHash(nextJson),
      state: nextState,
      seedVersion: 1,
      initChoice: input.choice,
    };
  });

  return executeTransaction();
}

export interface WorkspaceHistoryItem {
  id: string;
  revision: number;
  reason: string;
  created_at: string;
}

export function getUserWorkspaceHistory(userId: string): WorkspaceHistoryItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, revision, reason, created_at
    FROM workspace_history
    WHERE user_id = ?
    ORDER BY revision DESC
    LIMIT 30
  `).all(userId) as WorkspaceHistoryItem[];

  return rows;
}

export function getUserBackupExport(userId: string) {
  const current = getUserWorkspace(userId);
  if (!current || !current.state) return null;

  const exportedState = JSON.parse(JSON.stringify(current.state)) as AppState;
  const db = getDb();
  const attachmentsDir = getAttachmentsDir();

  const resolveImageToDataUrl = (image: unknown, field: string): string => {
    if (typeof image !== 'string' || !image) return '';
    if (POSE_RE.test(image)) return image;
    if (image.startsWith('/branding/')) return image;
    if (image.startsWith('data:image/')) {
      const comma = image.indexOf(',');
      if (comma !== -1) {
        const b64 = image.slice(comma + 1);
        const approxBytes = Math.ceil((b64.length * 3) / 4);
        if (approxBytes > MAX_FILE_SIZE_BYTES) {
          throw new Error(`${field} 图片大小超过 10MB 限制`);
        }
      }
      return image;
    }
    const mediaId = parseMediaRef(image);
    if (!mediaId) {
      if (image.startsWith('https://')) return image;
      throw new Error(`${field} 包含不受支持的图片引用形式: ${image.slice(0, 30)}`);
    }

    const row = db.prepare(`
      SELECT filename, mime_type, byte_size, sha256 FROM media_records WHERE id = ? AND user_id = ?
    `).get(mediaId, userId) as { filename: string; mime_type: string; byte_size: number; sha256: string } | undefined;

    if (!row) {
      throw new Error(`备份引用的媒体附件不存在或不属于当前账号: ${mediaId}`);
    }

    const diskPath = path.join(attachmentsDir, row.filename);
    if (!fs.existsSync(diskPath)) {
      throw new Error(`备份引用的媒体文件缺失: ${mediaId}`);
    }

    const stat = fs.statSync(diskPath);
    if (stat.size !== row.byte_size || stat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`备份引用的媒体文件大小不匹配或超过 10MB 限制: ${mediaId}`);
    }

    const fileBuf = fs.readFileSync(diskPath);
    const fileSha = crypto.createHash('sha256').update(fileBuf).digest('hex');
    if (fileSha !== row.sha256) {
      throw new Error(`备份引用的媒体文件已损坏 (SHA不匹配): ${mediaId}`);
    }

    const mime = row.mime_type || detectImageMime(fileBuf) || 'image/png';
    return `data:${mime};base64,${fileBuf.toString('base64')}`;
  };

  if (exportedState.profile?.avatar) {
    exportedState.profile.avatar = resolveImageToDataUrl(exportedState.profile.avatar, 'profile.avatar');
  }

  if (Array.isArray(exportedState.wrong)) {
    for (let i = 0; i < exportedState.wrong.length; i++) {
      const w = exportedState.wrong[i];
      if (w.image) {
        w.image = resolveImageToDataUrl(w.image, `wrong[${i}].image`);
      }
      if (Array.isArray(w.images)) {
        w.images = w.images.map((img, j) => resolveImageToDataUrl(img, `wrong[${i}].images[${j}]`));
      }
    }
  }

  const backupObj = {
    app: '考公工作台·土豆新版',
    version: exportedState.version,
    exportedAt: new Date().toISOString(),
    userId,
    revision: current.revision,
    generationId: current.generationId,
    state: exportedState,
  };

  const jsonString = JSON.stringify(backupObj);
  const totalBytes = Buffer.byteLength(jsonString, 'utf8');
  if (totalBytes > 50 * 1024 * 1024) {
    throw new Error(`导出备份体积 (${totalBytes} 字节) 超出 50MB 限制，已停止导出`);
  }

  return backupObj;
}

export function restoreUserFromHistory(userId: string, historyId: string) {
  const db = getDb();
  const currentGen = getCurrentGenerationId();

  const historyRow = db.prepare(`
    SELECT * FROM workspace_history WHERE id = ? AND user_id = ?
  `).get(historyId, userId) as {
    id: string;
    user_id: string;
    revision: number;
    reason: string;
    state_json: string;
    created_at: string;
  } | undefined;

  if (!historyRow) {
    return { ok: false, status: 404, message: '历史快照不存在或无权访问' };
  }

  // Before restoring, extract all media references from historyRow.state_json
  let mediaIds: string[];
  try {
    mediaIds = extractMediaIdsFromStateJson(historyRow.state_json);
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'CORRUPTED_HISTORY_JSON',
      message: '该历史版本数据已损坏，无法恢复',
    };
  }
  if (mediaIds.length > 0) {
    const ownership = validateMediaRefsOwnership(userId, mediaIds);
    if (!ownership.valid) {
      return {
        ok: false,
        status: 409,
        code: 'RESTORE_MEDIA_UNAVAILABLE',
        message: '该历史版本引用的媒体附件已缺失或损坏，无法恢复',
      };
    }
  }

  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(userId) as WorkspaceRow | undefined;
    const currentRevision = existing ? existing.revision : 0;
    const nextRevision = currentRevision + 1;
    const nowIso = new Date().toISOString();

    // Preserve the current state before replacing
    if (existing) {
      const currentHistoryId = `hist_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(currentHistoryId, userId, existing.revision, `pre_restore_from_${historyRow.revision}`, existing.state_json, nowIso);
    }

    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    `).run(userId, nextRevision, currentGen, historyRow.state_json, parseStateJson(historyRow.state_json)?.version || 3, nowIso);

    // R18: bounded retention for the new history write (only >7-day rows are pruned)
    pruneWorkspaceHistory(userId, new Date(nowIso), db);

    return nextRevision;
  });

  const newRevision = tx();
  const parsedState = parseStateJson(historyRow.state_json);

  return {
    ok: true,
    status: 200,
    message: `已成功将个人工作区恢复至历史版本（原修订号: ${historyRow.revision}，新修订号: ${newRevision}）`,
    revision: newRevision,
    state: parsedState,
  };
}

export function verifyWorkspaceUserMatch(req: any, authenticatedUserId: string): { ok: boolean; status?: number; error?: any } {
  const headerWorkspaceUser = typeof req?.header === 'function' ? req.header('x-workspace-user') : (req?.headers && req.headers['x-workspace-user']);
  if (headerWorkspaceUser && typeof headerWorkspaceUser === 'string' && headerWorkspaceUser !== authenticatedUserId) {
    return {
      ok: false,
      status: 409,
      error: {
        ok: false,
        code: 'SESSION_ACCOUNT_MISMATCH',
        message: 'Requested workspace user does not match active session',
      },
    };
  }
  return { ok: true };
}

