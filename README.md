# 考公工作台 · 土豆新版 (移动端独立工程)

基于 React 18 + TypeScript + Vite + Tailwind CSS 从零构建的全新移动端备考工作台，视觉风格为「奶油白、鼠尾草绿、黄色土豆吉祥物」。

---

## 一、项目特性与架构边界

1. **零污染与数据隔离**：
   - 采用独立存储命名空间 `potato_study_v2`，不读取、修改或污染原单文件版的 `civilExamWorkbenchOfflineEightSubjectV1`。
   - 原项目目录 `/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台` 保持 **100% 只读**。
2. **完整 50 屏画板覆盖**：
   - 对应 Figma Section `29:420` 的全部 50 个节点。
   - 内置 **「50 屏矩阵直达」** 检查器，可在桌面端或移动端一键直达任意画面进行视觉与交互验收。
3. **三种移动设备尺寸校核**：
   - `412 × 915` (主逻辑尺寸，Google Pixel)
   - `393 × 873` (iPhone 标屏)
   - `360 × 800` (紧凑型安卓)
   - `100% Full` (自适应移动端视口)
4. **科学严谨的备考业务闭环**：
   - 正向累计计时（非番茄倒计时），支持多任务同时运行。
   - 题本（14本）、网课（7门）与事项库自动维持一对一严格映射。
   - 错题照片支持本地多选与前端压缩归档。
   - 学情分析严格加权核算（基准演示：1260分钟 / 420题 / 84错 / 80% 正确率，八科分钟精准自洽）。
   - 8 类高危操作（删除、重置、覆盖、登出）配备独立二次确认与影响范围说明。

---

## 二、本地快速启动与运行

```bash
# 1. 进入工程根目录
cd "/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版"

# 2. 启动开发调试服务 (运行于独立空闲端口 5174，不与原 3300 服务冲突)
npm run dev

# 3. 构建生产产物并启动本地预览
npm run build
npm run preview
```

- **开发服务器**: `http://localhost:5174/`
- **生产预览**: `http://localhost:4174/`

---

## 三、目录结构

```
考公工作台-土豆新版/
├── COVERAGE-50-SCREENS.md     # 50 屏逐屏实现与验收状态总表
├── README.md                  # 本说明文档
├── package.json               # 依赖配置
├── vite.config.ts             # Vite 配置 (端口 5174 / 4174)
├── tailwind.config.js         # 设计 Token 与颜色扩展
├── reference/                 # 只读设计资料快照基准
│   ├── SOURCES.md             # 原始文件绝对路径、Figma链接及 SHA-256 校验和
│   ├── potato-android/        # 原始 50 份 Scene JSON、28 张原设计截图与预览
│   └── supplementary-screens/ # Headless Chrome 补齐的其余 22 张设计参照截图
├── public/
│   └── assets/
│       └── potato-poses.png   # 土豆 8 动作独立吉祥物图集
└── src/
    ├── types/                 # TypeScript 类型定义
    ├── constants/             # 预设数据与 1260m/420q/84e 学情基准
    ├── context/               # 独立数据 Store 与操作方法 (含 1对1 映射与自检)
    ├── components/
    │   ├── common/            # 土豆雪碧图组件、按钮、卡片、弹窗、进度条
    │   └── views/             # 5 大主入口页面、计时全屏、登记表单、50屏导航器
    ├── App.tsx                # 移动端手机外框容器与主路由
    └── main.tsx               # 挂载入口
```

---

## 四、后续 Android WebView 接入说明

新工程输出标准 HTML5 产物（`dist/` 目录）。后续可将 `dist/` 产物资源打包进 Android 工程的 `assets/` 目录，由 AppCompatActivity + WebView 承载，无需修改后端接口规范。
