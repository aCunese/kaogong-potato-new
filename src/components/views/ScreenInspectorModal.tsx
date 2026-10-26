import React, { useState } from 'react';
import { Modal, Tag, Button } from '../common/UIComponents';
import { CheckCircle2, ExternalLink, Eye, Layers } from 'lucide-react';

export interface ScreenDef {
  id: string;
  nodeId: string;
  name: string;
  category: 'core' | 'flow' | 'extra' | 'states' | 'confirm';
  desc: string;
  hasRefScreenshot: boolean;
  refScreenshotFile?: string;
}

export const ALL_50_SCREENS: ScreenDef[] = [
  // 1-8 Core
  { id: 'today', nodeId: '8:26', name: '今日计划', category: 'core', desc: '首页三倒计时、今日计划、学习分钟概览、打招呼土豆', hasRefScreenshot: true, refScreenshotFile: '01-today.png' },
  { id: 'library', nodeId: '12:42', name: '事项库', category: 'core', desc: '事项库列表、题本与网课自动同步、默认时长设定、加入今天', hasRefScreenshot: true, refScreenshotFile: '02-library.png' },
  { id: 'books', nodeId: '12:271', name: '题本进度', category: 'core', desc: '题本列表、做题进度条、正确率、平均题速、修改与删除', hasRefScreenshot: true, refScreenshotFile: '03-books.png' },
  { id: 'courses', nodeId: '12:564', name: '网课进度', category: 'core', desc: '课程列表、已听课时、累计时长、课程外链唤起', hasRefScreenshot: true, refScreenshotFile: '04-courses.png' },
  { id: 'wrong', nodeId: '12:833', name: '错题复盘', category: 'core', desc: '按题本分组错题照片、大图查看、相册上传导入、原因笔记', hasRefScreenshot: true, refScreenshotFile: '05-wrong.png' },
  { id: 'overall', nodeId: '12:1075', name: '总体分析', category: 'core', desc: '时间范围切换、八科时间分布扇形图、各科每日正确率曲线', hasRefScreenshot: true, refScreenshotFile: '06-overall.png' },
  { id: 'monthly', nodeId: '12:1315', name: '每月分析', category: 'core', desc: '年月选择、四大指标、八科正确率与用时分布', hasRefScreenshot: true, refScreenshotFile: '07-monthly.png' },
  { id: 'settings', nodeId: '12:1579', name: '我的工作台', category: 'core', desc: 'APK下载入口、云端多用户同步、JSON备份导入导出、数据自检', hasRefScreenshot: true, refScreenshotFile: '08-settings.png' },

  // 9-20 Flow
  { id: 'focus', nodeId: '12:1773', name: '专注计时', category: 'flow', desc: '正向累计大时钟、计划时长对比、暂停/继续、提前完成', hasRefScreenshot: true, refScreenshotFile: '09-focus.png' },
  { id: 'add-plan', nodeId: '12:1867', name: '加入今日计划', category: 'flow', desc: '从事项库下拉选择加入今日、设定计划分钟', hasRefScreenshot: true, refScreenshotFile: '10-add-plan.png' },
  { id: 'complete-book', nodeId: '12:1993', name: '完成刷题登记', category: 'flow', desc: '填写本次做题数、错题数、实际学习分钟', hasRefScreenshot: true, refScreenshotFile: '11-complete-book.png' },
  { id: 'complete-course', nodeId: '12:2103', name: '完成网课登记', category: 'flow', desc: '填写本次完成课时、实际学习分钟', hasRefScreenshot: true, refScreenshotFile: '12-complete-course.png' },
  { id: 'complete-custom', nodeId: '12:2196', name: '完成事项登记', category: 'flow', desc: '只读事项与科目、填写实际学习分钟', hasRefScreenshot: true, refScreenshotFile: '13-complete-custom.png' },
  { id: 'complete-success', nodeId: '12:2293', name: '登记成功', category: 'flow', desc: '庆祝土豆、本次成果总结卡片、返回今日', hasRefScreenshot: true, refScreenshotFile: '14-complete-success.png' },
  { id: 'book-edit', nodeId: '12:2365', name: '新增/编辑题本', category: 'flow', desc: '题本7字段完整表单：名称、科目、总题、页数、已做、错题、累计', hasRefScreenshot: true, refScreenshotFile: '15-book-edit.png' },
  { id: 'course-edit', nodeId: '12:2496', name: '新增/编辑网课', category: 'flow', desc: '网课6字段表单：名称、科目、总课时、已完成、用时、外链', hasRefScreenshot: true, refScreenshotFile: '16-course-edit.png' },
  { id: 'custom-add', nodeId: '12:2624', name: '新增自定义事项', category: 'flow', desc: '名称、八科之一选择、默认分钟设定', hasRefScreenshot: true, refScreenshotFile: '17-custom-add.png' },
  { id: 'photo-import', nodeId: '13:158', name: '导入错题照片', category: 'flow', desc: '所属题本选择、相册多选、复盘笔记填写', hasRefScreenshot: true, refScreenshotFile: '18-photo-import.png' },
  { id: 'wrong-detail', nodeId: '13:340', name: '错题详情', category: 'flow', desc: '大图展示、所属题本标签、日期、详细思路复盘', hasRefScreenshot: true, refScreenshotFile: '19-wrong-detail.png' },
  { id: 'countdown', nodeId: '13:447', name: '设置考试日期', category: 'flow', desc: '国考/省考/事业编日期编辑弹窗', hasRefScreenshot: true, refScreenshotFile: '20-countdown.png' },

  // 21-28 System & States
  { id: 'guest', nodeId: '13:616', name: '未登录工作台', category: 'flow', desc: '未登录身份状态卡片、离线提示、引导登录', hasRefScreenshot: true, refScreenshotFile: '21-guest.png' },
  { id: 'login', nodeId: '13:779', name: '登录界面', category: 'flow', desc: '用户名、密码、转小写兼容', hasRefScreenshot: true, refScreenshotFile: '22-login.png' },
  { id: 'register', nodeId: '13:879', name: '注册界面', category: 'flow', desc: '用户名>=2字符、密码>=4字符', hasRefScreenshot: true, refScreenshotFile: '23-register.png' },
  { id: 'sync', nodeId: '13:976', name: '同步管理', category: 'flow', desc: '最近同步时间、上传覆盖、拉取覆盖', hasRefScreenshot: true, refScreenshotFile: '24-sync.png' },
  { id: 'backup', nodeId: '13:1095', name: '数据备份', category: 'flow', desc: '导出JSON、导入恢复校验', hasRefScreenshot: true, refScreenshotFile: '25-backup.png' },
  { id: 'profile', nodeId: '13:1231', name: '编辑资料', category: 'flow', desc: '显示昵称修改、头像选择', hasRefScreenshot: true, refScreenshotFile: '26-profile.png' },
  { id: 'today-empty', nodeId: '13:1312', name: '今日空态', category: 'flow', desc: '今日无日程时的空态插画与挑选引导', hasRefScreenshot: true, refScreenshotFile: '27-today-empty.png' },
  { id: 'delete-confirm', nodeId: '13:1459', name: '删除确认', category: 'flow', desc: '通用删除确认交互', hasRefScreenshot: true, refScreenshotFile: '28-delete-confirm.png' },

  // 29-34 Extra Variants (supplementary reference screens attached)
  { id: 'book-add', nodeId: '13:1656', name: '新增空白题本', category: 'extra', desc: '空白新增题本表单变体', hasRefScreenshot: true, refScreenshotFile: '29-book-add.png' },
  { id: 'course-add', nodeId: '13:1791', name: '新增空白网课', category: 'extra', desc: '空白新增网课表单变体', hasRefScreenshot: true, refScreenshotFile: '30-course-add.png' },
  { id: 'today-multi', nodeId: '13:1924', name: '多任务同时计时', category: 'extra', desc: '多任务并发计时状态展示', hasRefScreenshot: true, refScreenshotFile: '31-today-multi.png' },
  { id: 'focus-paused', nodeId: '13:2191', name: '专注计时已暂停', category: 'extra', desc: '计时暂停状态与继续操作', hasRefScreenshot: true, refScreenshotFile: '32-focus-paused.png' },
  { id: 'complete-course-success', nodeId: '13:2294', name: '网课完成成功反馈', category: 'extra', desc: '网课课时登记成功反馈', hasRefScreenshot: true, refScreenshotFile: '33-complete-course-success.png' },
  { id: 'complete-custom-success', nodeId: '13:2378', name: '事项完成成功反馈', category: 'extra', desc: '自定义学习时间登记成功', hasRefScreenshot: true, refScreenshotFile: '34-complete-custom-success.png' },

  // 35-37 States long boards
  { id: 'states-empty', nodeId: '13:2470', name: '空态集合画板', category: 'states', desc: '日程/错题/学情空态合集', hasRefScreenshot: true, refScreenshotFile: '35-states-empty.png' },
  { id: 'states-sync', nodeId: '13:2700', name: '同步状态集合画板', category: 'states', desc: '同步中/离线/过期/冲突状态合集', hasRefScreenshot: true, refScreenshotFile: '36-states-sync.png' },
  { id: 'states-form', nodeId: '13:2847', name: '表单校验集合画板', category: 'states', desc: '必填/超限/格式校验合集', hasRefScreenshot: true, refScreenshotFile: '37-states-form.png' },

  // 38-45 8 Confirm dialogs
  { id: 'confirm-book', nodeId: '13:3182', name: '删除题本确认', category: 'confirm', desc: '说明移除题本与对应事项，保留历史记录', hasRefScreenshot: true, refScreenshotFile: '38-confirm-book.png' },
  { id: 'confirm-course', nodeId: '13:3249', name: '删除网课确认', category: 'confirm', desc: '说明移除网课与对应事项', hasRefScreenshot: true, refScreenshotFile: '39-confirm-course.png' },
  { id: 'confirm-photo', nodeId: '13:3316', name: '删除错题照片确认', category: 'confirm', desc: '说明不影响题本做题与错题总数', hasRefScreenshot: true, refScreenshotFile: '40-confirm-photo.png' },
  { id: 'confirm-reset', nodeId: '13:3383', name: '恢复初始数据确认', category: 'confirm', desc: '高危提示导出备份，说明恢复默认', hasRefScreenshot: true, refScreenshotFile: '41-confirm-reset.png' },
  { id: 'confirm-import', nodeId: '13:3453', name: '导入覆盖确认', category: 'confirm', desc: '校验后覆盖提醒', hasRefScreenshot: true, refScreenshotFile: '42-confirm-import.png' },
  { id: 'confirm-upload', nodeId: '13:3523', name: '上传覆盖云端确认', category: 'confirm', desc: '云端覆盖影响提示', hasRefScreenshot: true, refScreenshotFile: '43-confirm-upload.png' },
  { id: 'confirm-pull', nodeId: '13:3593', name: '从云端拉取覆盖确认', category: 'confirm', desc: '本地未同步数据被覆盖提示', hasRefScreenshot: true, refScreenshotFile: '44-confirm-pull.png' },
  { id: 'confirm-logout', nodeId: '13:3663', name: '退出登录确认', category: 'confirm', desc: '转入离线单机模式提示', hasRefScreenshot: true, refScreenshotFile: '45-confirm-logout.png' },

  // 46-50 Remaining screens
  { id: 'download-apk', nodeId: '13:3730', name: 'APK 下载页面', category: 'extra', desc: '专属安卓安装包介绍与下载', hasRefScreenshot: true, refScreenshotFile: '46-download-apk.png' },
  { id: 'month-picker', nodeId: '13:3828', name: '月度选择器', category: 'extra', desc: '月度切换弹窗', hasRefScreenshot: true, refScreenshotFile: '47-month-picker.png' },
  { id: 'overall-legend', nodeId: '13:3931', name: '总体分析图例详情', category: 'extra', desc: '八科投入分钟明细表', hasRefScreenshot: true, refScreenshotFile: '48-overall-legend.png' },
  { id: 'focus-course', nodeId: '13:4135', name: '网课专注计时', category: 'extra', desc: '网课听课专注计时变体', hasRefScreenshot: true, refScreenshotFile: '49-focus-course.png' },
  { id: 'focus-custom', nodeId: '13:4220', name: '自定义专注计时', category: 'extra', desc: '自定义事项专注计时变体', hasRefScreenshot: true, refScreenshotFile: '50-focus-custom.png' },
];

export type ScreenSize = '360' | '393' | '412' | 'full';

interface ScreenInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJumpToScreen: (screenId: string) => void;
  screenSize?: ScreenSize;
  onSelectScreenSize?: (size: ScreenSize) => void;
}

export const ScreenInspectorModal: React.FC<ScreenInspectorModalProps> = ({
  isOpen,
  onClose,
  onJumpToScreen,
  screenSize = 'full',
  onSelectScreenSize,
}) => {
  const [filterCat, setFilterCat] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const filtered = ALL_50_SCREENS.filter(s => {
    if (filterCat !== 'all' && s.category !== filterCat) return false;
    if (search && !s.name.includes(search) && !s.id.includes(search) && !s.nodeId.includes(search)) return false;
    return true;
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="50 画面全矩阵导航与验收直达">
      <div className="space-y-4">
        {onSelectScreenSize && (
          <div className="flex items-center justify-between p-2.5 bg-paper rounded-xl border border-line text-xs">
            <span className="text-ink-muted font-medium">预览分辨率：</span>
            <div className="flex gap-1.5 font-mono">
              {[
                { id: 'full', label: '100% 全屏' },
                { id: '412', label: '412×915' },
                { id: '393', label: '393×873' },
                { id: '360', label: '360×800' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => onSelectScreenSize(opt.id as ScreenSize)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    screenSize === opt.id
                      ? 'bg-sage text-white font-bold'
                      : 'bg-cream/60 hover:bg-cream text-ink-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>共收录 50 个独立画板与状态</span>
          <span className="text-sage font-bold font-mono">50 画面交互已就绪</span>
        </div>

        {/* 筛选与搜索 */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="搜索画面名称、ID或节点..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-cream/70 border border-line rounded-xl text-xs focus:outline-none focus:border-sage"
          />
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            className="px-2.5 py-1.5 bg-cream/70 border border-line rounded-xl text-xs focus:outline-none focus:border-sage"
          >
            <option value="all">全部分类</option>
            <option value="core">核心模块 (8)</option>
            <option value="flow">主流程 (12+8)</option>
            <option value="extra">扩展变体 (11)</option>
            <option value="states">长画板状态 (3)</option>
            <option value="confirm">确认弹窗 (8)</option>
          </select>
        </div>

        {/* 50 屏滚动列表 */}
        <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
          {filtered.map((s, idx) => (
            <div
              key={s.id}
              className="p-3 bg-cream/40 border border-line/80 rounded-xl flex items-center justify-between gap-2.5 hover:border-sage transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-xs font-bold text-sage">#{idx + 1}</span>
                  <span className="text-xs font-bold text-ink-main truncate">{s.name}</span>
                  <Tag variant="gray" className="text-[10px] py-0 font-mono">{s.nodeId}</Tag>
                  {s.hasRefScreenshot && (
                    <Tag variant="sage" className="text-[10px] py-0">有设计截图</Tag>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted truncate">{s.desc}</p>
              </div>

              <Button
                data-screen-id={s.id}
                variant="primary"
                size="sm"
                className="shrink-0 text-xs py-1 px-2.5 h-7"
                onClick={() => {
                  onJumpToScreen(s.id);
                  onClose();
                }}
              >
                跳转此屏
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
