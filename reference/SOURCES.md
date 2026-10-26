# 考公工作台 · 原始设计与业务资料快照索引 (SOURCES.md)

- **快照创建时间**: `2026-10-26T09:13:53.495195`
- **原始资料绝对路径**:
  - 设计与原型实现: `/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台/output/design/potato-android`
  - 需求与分析文档: `/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台/output/design`
  - 原生产代码只读参考: `/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台` (未复制用户数据与库，按需只读查阅)

## Figma 核心链接与节点
- **Figma Design 完整文件**: https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy
- **Section (全部50画板)**: https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=29-420
- **首页 Frame (today)**: https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=8-26
- **界面总览 (5类)**: https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=16-26
- **需求文字 Frame**: https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=16-1015

## 50 画板节点与截图核对说明
原始资料共有 50 个独立节点定义（详见 `potato-android/figma/section-handoff.json`）。
其中 `screens/` 包含前 28 个画板的高保真设计截图 (`01-today.png` 至 `28-delete-confirm.png`)。
其余 22 个补充画面/状态（如多任务计时、空态集、同步态集、表单状态、8 类危险确认弹窗等）在 `potato-android/extra-pages.js` 中有完整实现逻辑，后续阶段将通过专用渲染工具补齐视觉快照。

## 复制文件清单与 SHA-256 校验和

共计复制 `200` 个文件：

| 文件相对路径 | 大小 (Bytes) | SHA-256 校验和 |
|---|---|---|
| `figma-android-redesign-prompt.md` | 21110 | `2783c612529e0644aec6b11eb3ed8c8c457067c83b5316763a68e73a938a5a90` |
| `project-functional-analysis.md` | 18185 | `134df7aef647019f14ce01a0ad6672397705efb8235bcd8ecae26c2a426cac08` |
| `potato-android/00-core-overview.png` | 487331 | `df0f945292518596930d8e77ee539e19a493b23880ffb0e29cad6b76a33f9a92` |
| `potato-android/00-flows-overview.png` | 969949 | `9c0b7ce3bba6447487c3065efad685ea2534d96946adc51e3a18f65d29bc52b2` |
| `potato-android/ANTIGRAVITY-FIGMA-HANDOFF.md` | 29397 | `508ca55f383b6692c8dbe8156a8ca843c631031c3788ce192c4175ee41fd6328` |
| `potato-android/ANTIGRAVITY-SETUP.md` | 2486 | `9d35855c65dfa63dadb11a159bf2e6a5dddfa8825e94576fcfbb22ad117f66f0` |
| `potato-android/DESIGN-NOTES.md` | 2950 | `c4020bf5e0aa839b6e26e78531e3a7a355a16cc0b012e90d86744e13f90f3462` |
| `potato-android/FIGMA-LINKS.md` | 7056 | `f6ec0a125daa2f167bdaa43f675f2e532ffecb4adfb2ea6e657c05ba40a77885` |
| `potato-android/FIGMA-MAKE-ALL-SCREEN-LINKS.txt` | 5549 | `4b556b227705ef842d5b9c4368c5816a548abeaf7fb55e3cdb14d6fda3b081b4` |
| `potato-android/FIGMA-MAKE-FIRST-MESSAGE.txt` | 1124 | `0d78cff61bd4bcef9e7f18fb822aaa0df7be8282d51e7eee0fe39932109fe01f` |
| `potato-android/FIGMA-MAKE-FULL-PROMPT.txt` | 28501 | `cb5df7b144f936d02032cfb56b03f15d902e168ba9ee12c33f089983d81dd15d` |
| `potato-android/FIGMA-MAKE-SECTION-REPLY.txt` | 2070 | `70185e25e4065e9881cc13264a923aefc279a5c6172d5accd2dcc81f1dcad23d` |
| `potato-android/FIGMA-MAKE-START-HERE.md` | 1832 | `7bfb049b93deb356a53700e53e5b0cef289bf67771f7aec46a9d83750da333b1` |
| `potato-android/FIGMA-REBUILD-PROMPT.md` | 22466 | `f97b7eb6fbce3c5d0347c4092873298ff5c0aed826a73724fc25b3f9cf6162e2` |
| `potato-android/FIGMA-REBUILD-PROMPT.txt` | 22466 | `f97b7eb6fbce3c5d0347c4092873298ff5c0aed826a73724fc25b3f9cf6162e2` |
| `potato-android/IMPLEMENTATION.md` | 2273 | `2470bf36c0e95d99dc6289e58c130951039ad8d471e7402bd4e0cff2d63b6143` |
| `potato-android/account.js` | 16067 | `2c90e0f8bf8016723e7bccdc843617dd909f9079c6ee3e2dc868a1305e7359ec` |
| `potato-android/analysis.js` | 23792 | `997ba94774b8738c6afffb4467d1b34e13f6db0f9219e2fe791c7ceab5a2326b` |
| `potato-android/app.js` | 4735 | `cc0ad7bddd9c560b3b3e57769ac89dbf34ffcc72639f24c301ca5bd1e7dd9d72` |
| `potato-android/asset-prompt.txt` | 1742 | `e7f436af1ce0d40a6cc0776e405e8ea646fbc5d4916f24ca98dcc5e07f15e72d` |
| `potato-android/extra-pages.js` | 37862 | `da220abd50f64ccf7388e0d790fa11343227e89ad4cc30a8ff30bb06cb65ba25` |
| `potato-android/figma-capture.html` | 1312 | `07a6851d4f19ebe701e68e351498926de66458c682ccc229335077da059bd07b` |
| `potato-android/index.html` | 757 | `28941c076c8100bbcd1fabd956320c25d7dc0f584be3f765799d9f25c10835aa` |
| `potato-android/learning.js` | 14669 | `cadddaf23a0efdad3c40185ca60a082fa27dd260c8e2048a41c1daecf527ea5e` |
| `potato-android/main-pages.js` | 16751 | `b0a87344822413e73bb518c3aa195b9fd357a5d1b5f5571d5cb079d3a8692591` |
| `potato-android/manifest.json` | 6218 | `fbc0e38348c83b85c7623b44a482a1f4b85d6fd49d662714e6bb1f54d7414be8` |
| `potato-android/prepare-antigravity-handoff.py` | 8879 | `4056d738a2ed9f3f0617f24720c2d191cbc2a64d2ca8469d01f65317c0bd027a` |
| `potato-android/prepare-make-handoff.py` | 9612 | `e8757c7fb351855bd561a7c1563a265adff64e0d39d91109c44021ff1c8bfce9` |
| `potato-android/render-screens.cjs` | 3098 | `6dfee5df8087d87703d3b22d7a540bca5bb663d57479736601da4f15937d6d9e` |
| `potato-android/render-verification.txt` | 7289 | `d7cb39d4521409265c4ef1a53873adf87893bc2448a83b340967d781df97be55` |
| `potato-android/styles.css` | 11488 | `c961a7969a1ae81002d11c896dde3d3b96f645feac311cfd52252b9b7d23fd0d` |
| `potato-android/ui.js` | 4015 | `fb23744e603ddc3088dbcd382096d322ada9ce08e97ebdfb201cbef616715211` |
| `potato-android/verification.json` | 6023 | `701afc1ab37c3b34cfdd61c0083ede9c4701d75cb82b6ddbdfb79abe6e580475` |
| `potato-android/screens/01-today-preview.png` | 70758 | `61e134710992b16d5878338316aebd1d33b5dfd991c589d0f45f717ca06dc1df` |
| `potato-android/screens/01-today.png` | 166924 | `87f7e2c4fffc7b76a6ea602e398447415f5095c4b691af7e1331abf52f10e9b2` |
| `potato-android/screens/02-library.png` | 136861 | `a6b8f084778bec274d94ddfe64a66710d7d8972c5453423e8b79673c4ec10a22` |
| `potato-android/screens/03-books.png` | 167505 | `4769623c056efb924f329fea56d7666df499046340f4d79404b1f7b9f06b2925` |
| `potato-android/screens/04-courses.png` | 149644 | `fb7d5aeba8385e43b4d80ba790b0a3bf4736d6fdf611a87735e8694f0368cc34` |
| `potato-android/screens/05-wrong.png` | 195432 | `7c75fc727607e8e92ba27293ffc53d2f3d502f7862c7bf9db77459d7c8be2b2e` |
| `potato-android/screens/06-overall.png` | 156207 | `ac1613f4ebcbe1276902d0ccf40df0512707f7a583ef277983db734a962c556e` |
| `potato-android/screens/07-monthly.png` | 160210 | `f3ac7c16b7ba3ef41c9a2002b88d20b884a90e95becf1d5e9787851d45f289fc` |
| `potato-android/screens/08-settings.png` | 155023 | `04e880f64072ad234838f92ec91940a49ad3f41cf4c4464b57a177330fcdd0f9` |
| `potato-android/screens/09-focus.png` | 127739 | `f949006d6e4c3901aa3fcebeb4e82f11344587797b94fe8d84dc344943af1aa4` |
| `potato-android/screens/10-add-plan.png` | 108283 | `de0e25db0f20da6db6a04bec9ebf938a713ae5dd3a539c83e8b5d52e6cb9001d` |
| `potato-android/screens/11-complete-book.png` | 115231 | `b77cee62277ad58fac2b7fd830336263e1caae6f92ad1db47c5834250cf78f1c` |
| `potato-android/screens/12-complete-course.png` | 99913 | `7ca579784b3c9f53179eec254acce9dcb123b6f7fa69434593d51a525162addb` |
| `potato-android/screens/13-complete-custom.png` | 97608 | `965e53c9948e0c2289de52cdbec39c4871767bf8d864e36922416c57527082d7` |
| `potato-android/screens/14-complete-success.png` | 125396 | `84c51f46599e61443ba9cee84237d903c065044e7ec4e938312160561dfe1597` |
| `potato-android/screens/15-book-edit.png` | 102560 | `dd0cda917d80280bbf91a050ecc3f0a996c6b8e57421629f35ecbace571a345f` |
| `potato-android/screens/16-course-edit.png` | 106544 | `dc47ab4367ca9d6cbc73b1737d0776fb9d89ffc1443abc776a02773d0cf35d8c` |
| `potato-android/screens/17-custom-add.png` | 86664 | `e3578620498a63e53110a454419172d5e25db002ba28fb13155b4cae125ccebe` |
| `potato-android/screens/18-photo-import.png` | 152186 | `3585aa23b01098b677b51e1826f11db96becfda6c26bd58d4381919ec0acc850` |
| `potato-android/screens/19-wrong-detail.png` | 141147 | `4093228948d11864a7f7ba2a0f75054e8e82ffa8d392c3413ee92a02db799541` |
| `potato-android/screens/20-countdown.png` | 85906 | `7a5f817b5c63e37dccde38be5e61348cb1430a9e558576f33e07036964488b5c` |
| `potato-android/screens/21-guest.png` | 165274 | `2569633063a84d8efdd844f80ffc8f088ec6ebb0d78d6fe0f0cea290387ca6aa` |
| `potato-android/screens/22-login.png` | 106794 | `3edb7e139698d074a10d301ec68c8cb2389e90dee8afba2013cd8f2262acc36b` |
| `potato-android/screens/23-register.png` | 105477 | `874c4f251fcefc6b22ca25a7108c9d44f9afbbca8a30f0f10f3a87d4f92714cf` |
| `potato-android/screens/24-sync.png` | 126299 | `d34055b8168af77ef604f6705a27493f7d9be82f8f83f3e14ffecc2e1abccf3e` |
| `potato-android/screens/25-backup.png` | 144219 | `59fd2839f0822eccdb1e7856d767602e58fccb5605441fed427859de0040830a` |
| `potato-android/screens/26-profile.png` | 130897 | `9f62f5e88970fcf38332bcf19fe4b1d522577544c7664403668732f9247d36cf` |
| `potato-android/screens/27-today-empty.png` | 180828 | `f1b9f15e42459db8740f5d920748dd7ecd0ebd0306930d025e1be84dd56914a7` |
| `potato-android/screens/28-delete-confirm.png` | 179103 | `56471618d0f2a5a1ae07db0b8992cb59af9aab2cf6d3e3cdf8e7ef1d5f0b1d4e` |
| `potato-android/screens/check-360-book-edit.png` | 99844 | `b327b7c0faa3ed06b34c37ff8d5b4d3c76d1c3b31279206cb531eb8777c105aa` |
| `potato-android/screens/check-360-login.png` | 104594 | `1b55e4ad4467d5f4ca19365e74440f3345ac055f367304bbcd08167cc9792453` |
| `potato-android/screens/check-360-monthly.png` | 138928 | `c9f5c750f48d3b398320a07735cdfb3a3d0cfbfc2284c415b9cfbbf0229eaaba` |
| `potato-android/screens/check-360-today.png` | 146596 | `2168e054c04933bb8ccd74555458a00028553ebb63c3fd9041cf180a930f5847` |
| `potato-android/figma/all-scenes-result.json` | 30826 | `91bc4c363aab5ab00a1ae1df090a35ab43cdf9c338692dd0995311203699381f` |
| `potato-android/figma/assets-result.json` | 528 | `cd9be99899fcba8e24815e5791a92ed2521cb79bc13509adcc06a93058339d51` |
| `potato-android/figma/batch-result-00.json` | 202 | `d12837e1e3c48bb12343be01775f38c42f51f65cc4adfe11b3f4a650f31fcc01` |
| `potato-android/figma/batch-result-01.json` | 4613 | `2d40f8784b4dd862dde6f00a5a466f05826658635ba8211aaa63e57ba3722891` |
| `potato-android/figma/batch-result-02.json` | 6114 | `56519bc9d27faf5eec029db5f07ff91e7b13c9edb8e4b86f8928d327392e2e4d` |
| `potato-android/figma/batch-result-03.json` | 5526 | `d6e0712abea6611350b6f71860edd22d93662e21ec71c0feae5a0b7077834daa` |
| `potato-android/figma/batch-result-04.json` | 4415 | `3f68c113e909b4ddc426a4610ea24178157db03d6c4a5059aa481668a12100b3` |
| `potato-android/figma/batch-result-05.json` | 4693 | `7db791a996a884404339b2edc0a24e35ac3e89b389a5f789161cc1b6d5e1ae04` |
| `potato-android/figma/batch-result-06.json` | 4919 | `9af97875ac1c09446827961b34e72daa7f569dd6c8b4935901bb08a20cbe7ca7` |
| `potato-android/figma/batch-result-07.json` | 6151 | `2c0115fa91ad96a1da2fd0927bf7d26881785ed88e6d94a17e9f8731a29dd3f4` |
| `potato-android/figma/batch-result-08.json` | 6368 | `fb537f927076808f285def55d581e87ca147f62bbcf4270972e30d21e531c814` |
| `potato-android/figma/batch-result-09.json` | 5923 | `d0370dec80b2ba2bb56a24950cdca978725d3e1a8bc1ed79443d70bd1878e771` |
| `potato-android/figma/batch-result-10.json` | 4517 | `e28c880aaeb6aa4d125383b97dc2694bd36a6d7b6509152ce723f7386d0f65c8` |
| `potato-android/figma/batch-result-11.json` | 2961 | `1a8f2e6d432aa03445d182ff59488a5f4eaca5c0eb3812d518536d9a33ec60d4` |
| `potato-android/figma/batch-result-12.json` | 4678 | `39ebb75f05a2bd18a8792c388c2aec9ae0cf86327039fb5ee989274bc09784e5` |
| `potato-android/figma/batch-result-13.json` | 7105 | `f1886e5e23ca245f9684f1fbf1759d5e768bcd782aa18928a1cc5860f5ccbd07` |
| `potato-android/figma/batch-result-14.json` | 6962 | `20bd6413e76427e87479b36e91d73e65b28777c70099db1053c7a749bfe7b7c8` |
| `potato-android/figma/batch-result-15.json` | 7562 | `c4f5596d2510c2e3bfd105974aa2aabb453fd5ee8aa566e87513ca8136d15577` |
| `potato-android/figma/batch-result-16.json` | 4951 | `9a7eaccb90366abd050eeb7bceee66a0fc399e50964ce5841618f11598362adb` |
| `potato-android/figma/batch-result-17.json` | 5647 | `119f1760ea78362c1ede545a805b1709b3eba18b6568d1ea0ae0bb9a18f851e2` |
| `potato-android/figma/batch-result-18.json` | 5681 | `64e7139cc287a6e6bb1e2b0f5182f9ace11877cc183073b62f6f632770488933` |
| `potato-android/figma/batch-result-19.json` | 7791 | `0dd1fd2fb1b3836537efc0ec6547301822212c8b17554bbc28ef25e448a3a560` |
| `potato-android/figma/batch-result-20.json` | 6348 | `6099c6a784486219c18d3b9de6b319fae054b5703428a43862318dd8d8243376` |
| `potato-android/figma/batch-result-21.json` | 7546 | `b90cf5bca2b21ea32ca4ad912b5ccc04b1fbaca6021c61519ba597f5ef39f600` |
| `potato-android/figma/batch-result-22.json` | 6614 | `2f0d923566dee89e41860ab5af99d42c3e1b4ca7bb19c30cdd90e8e35ae74fa3` |
| `potato-android/figma/batch-result-23.json` | 6582 | `73c8066ba706b421d6c132bd3ab5643c88909eb9b0509551c52a9dd4f04f55d7` |
| `potato-android/figma/batch-result-24.json` | 3501 | `3d84bb7afb5226e35ceecbf6f89d12c1c391658565ff598d05f6b2fb725487c8` |
| `potato-android/figma/build-assets.js` | 2364 | `85c589cf6b36f41a4c513833f4fe283215f7698cf41561cd9320cf087ef7ce11` |
| `potato-android/figma/build-batch-00.js` | 37563 | `5a48a711dcd258f053565376c79661d8bc1d1b9950240fc2821feb6839d0e300` |
| `potato-android/figma/build-batch-01.js` | 37157 | `9b1b4c1f80770a5aebc5b9cd0bd75c7e0c40ecd3a76c94a6c4c8ae0c553413ce` |
| `potato-android/figma/build-batch-02.js` | 43368 | `e48e26d241506db76e5d6aee5d9661aa6ddae2aa71b5177da76bcfa2c16b33c2` |
| `potato-android/figma/build-batch-03.js` | 41103 | `e1aba2c2d38e2908f7784bc2b2d150b7682bf3c5364a4b762111372edf822072` |
| `potato-android/figma/build-batch-04.js` | 46528 | `3c0de12bf020b08c5016c8acab96fa784806ba522c397ea517693e59136214db` |
| `potato-android/figma/build-batch-05.js` | 40367 | `4b57cfa75ea16555eeb3ed5a24ccc6b3dade90e1b580e557a2543c83dcc604f4` |
| `potato-android/figma/build-batch-06.js` | 38231 | `535539d0ac22afef86f5316ec3b04f3cbb497c2f728bbbd7f90aa03b50d929f7` |
| `potato-android/figma/build-batch-07.js` | 44097 | `7e5917e59b770d696ad88adc975cece400795106aea953661f19bcfcd34839e0` |
| `potato-android/figma/build-batch-08.js` | 47680 | `ca41703e3420509a4a4a18e59b026b21c80a82d2beea4120756b615b5651a253` |
| `potato-android/figma/build-batch-09.js` | 44713 | `7cbc308a5b611780db54fc22c4ffdadd236f02a6056be958b6c4fe60193cc379` |
| `potato-android/figma/build-batch-10.js` | 38610 | `25de2e6b02df4feb5bbd23b83a229cd35a737e291e0c569b732f862e8b1a7325` |
| `potato-android/figma/build-batch-11.js` | 37776 | `1d4924dca545d1c80ca7f04ba9a641927adede0ae52ce9ee59a1463714783d88` |
| `potato-android/figma/build-batch-12.js` | 48386 | `1e54a9ec830254eae950697e64fdaea01a97b332976197b02e169c6d353cab46` |
| `potato-android/figma/build-batch-13.js` | 51712 | `2563345c45684385a46f26f589da4e0f497ea63effc51a0bdc432b3f0abe4014` |
| `potato-android/figma/build-batch-14.js` | 48872 | `8dbf71198589a097e13394de2eaae44d466c56fe22907525882409f877b8a707` |
| `potato-android/figma/build-batch-15.js` | 49365 | `2748175cc2112b15a1ce6ba675b39c412ed541cb924085d6adb2872cecdf03c9` |
| `potato-android/figma/build-batch-16.js` | 41992 | `e2f1a854e3279401d60e6aafd979cee40a7e8d2fbd6e602e853d6c0baa788be4` |
| `potato-android/figma/build-batch-17.js` | 41511 | `b4a46790ae338448ecb641e1c5394b4eec31fab1d2e7e32e3e36305146797efc` |
| `potato-android/figma/build-batch-18.js` | 40775 | `a4255b0cd212e775aba9a788ac129dfa6e1260af231d00bf9512c3e137ecc6ac` |
| `potato-android/figma/build-batch-19.js` | 52023 | `632806f642e0a15356ba98f630c56165de05b10781e4aa61e94f61a87b13bdbe` |
| `potato-android/figma/build-batch-20.js` | 51047 | `23a67baedeed675fb1997009260ebe372fb5834f34f6eb8db68567e82d7d3abe` |
| `potato-android/figma/build-batch-21.js` | 46269 | `bdd059854951bc548c7aab1e5bf95f7f9e7e2db222d9404f00d48a7ab2a61cc7` |
| `potato-android/figma/build-batch-22.js` | 44117 | `5429fd80135a0726de74d8edac3e5b22d4dbbda667c3aea80279f1f0ab6c7ed3` |
| `potato-android/figma/build-batch-23.js` | 49373 | `5613a1fa7d5f7544b97ada031ef323c803d3280494e1c3466f65690ecaf753cb` |
| `potato-android/figma/build-batch-24.js` | 30157 | `e67871def07a29b60945cbca313905522a78e73c63965cb780bc423392451545` |
| `potato-android/figma/build-batch-25.js` | 48956 | `43995c59ef59c8629840592fe8ba9d2f58228ccd5e8a392a38f2150f34f2a401` |
| `potato-android/figma/build-batch-26.js` | 29740 | `d0c820eb946ca7e7fa8b2954a476aa17a20d36321a151e041dd4ed60214e1488` |
| `potato-android/figma/build-coverage.js` | 4302 | `aa01716b3d16330b1db6afc4b603edc1621403781b09f97f078ad5c512cc4e80` |
| `potato-android/figma/build-documents.py` | 8533 | `c94ddc1477ae7e04136d5b6f64b0dee53d1a29a2459087630b824ba80d0ab26a` |
| `potato-android/figma/build-foundations.js` | 7590 | `9e0150373d3afa2fa15a77135994cc1eabd45cfd3cb654e8d67a4c87eab78d8d` |
| `potato-android/figma/build-overview.js` | 3568 | `187856a140326f56e1a12803821e52e6c93c49335662de84d6ca1b720cd27974` |
| `potato-android/figma/build-prompt.js` | 24248 | `58a5378964ca619cdb40f9a44b540147333f136b74fccdb5bd72a3cef178c037` |
| `potato-android/figma/build-prototype.js` | 15645 | `46f9e797ca17f11f6a567d5f86b2c0abf20f136d550029da3d8ac8cac6d106d8` |
| `potato-android/figma/build-sample.js` | 37525 | `6050394ec6d208e94218182a6027caeba21e4399314dc99f47f1a2fa3f93a381` |
| `potato-android/figma/build-scenes.js` | 9645 | `9a98e1a2671731c0c4041a4527c9b27b61f992051ffabf082e772b1d97cf4c94` |
| `potato-android/figma/compact-scenes.json` | 790368 | `5a0ffc7fb7c9f58d902c946427de10f3f933bfe525d5737943c0d58d120dde57` |
| `potato-android/figma/coverage-result.json` | 639 | `0e75de783fd50eee63347e1bfd4090ea3378a69fad48dce5ea9e38326acb9c20` |
| `potato-android/figma/export-scenes.cjs` | 15400 | `f77347115174fccdc5463603a05efc3c605b8d2fffa95b4e6b87c78c9027c9cb` |
| `potato-android/figma/final-audit.json` | 7942 | `dca4306b98ca89efc71327350b3199aa325c65043d28523a04dd08fb9f4551b3` |
| `potato-android/figma/foundations-result.json` | 6476 | `434c25b0361e409990ed637ced6ed657365d14d0aa7e29e8d55ef1f6aa1c2f8c` |
| `potato-android/figma/handoff.json` | 1430 | `b6d5f3cf65cdec98604f5e97c8b9591793940f52f725e5a6422835e6f3b78f8c` |
| `potato-android/figma/icons.json` | 1837 | `6fc5adc182ca0040052e1c21db447a367f59ffbcd88956d3c147289d9469f343` |
| `potato-android/figma/link-check-latest.json` | 9875 | `f4656f22d1e182e8934e2293e9bfc32ccf34a0165577d64adf6fb59d3dde1b89` |
| `potato-android/figma/minimal-state.json` | 2422 | `0bc16eec4c215506e31c47ada8eba3836835035107e6b16ffbbf825b80f25987` |
| `potato-android/figma/overview-result.json` | 12770 | `5eca18d52335c747c39790e3a34ac5ca61522ea386ad9bce15e6d71de59b8f14` |
| `potato-android/figma/polish-result.json` | 855 | `6e2b23d877be7da4e174203818d49110046146bcbbb30aa19b06ac751a78f0f4` |
| `potato-android/figma/prepare-scenes.py` | 2777 | `99c526c7981379bc91b9ad3ecc1728b9e6227d9f7109fedd035752aa611e43f7` |
| `potato-android/figma/prompt-result.json` | 191 | `e9c9f8016cf7ab01cc023046bd1e63b7a3ecc55ece80bc55bafe680604932ca9` |
| `potato-android/figma/prototype-result.json` | 28301 | `8bf0d5531b0e365267beb6fe6938d95fba9802636674c291a9e7f89759658081` |
| `potato-android/figma/sample-data.js` | 53916 | `6431f85327e030ef58a71f3061d98b0bd8300c6661723538e5a1ab2a09b78a12` |
| `potato-android/figma/sample-native-result.json` | 4685 | `699d36ae25a198a9463891db1643faba1287c62f6b2f81a8e440327ab24887c8` |
| `potato-android/figma/scene-add-plan.json` | 26412 | `281244b8e7b372fd23b02257c83e0ca587ae4a062f2e08e2a63736db025ab1bb` |
| `potato-android/figma/scene-backup.json` | 27962 | `d56ca9a6dbe08a61446e9e1eb6fa33c4b220800d10db000a70f5f2234907c6f9` |
| `potato-android/figma/scene-book-add.json` | 29310 | `9fdfe50f6655a5fbeac88f443a6af3e9d8746c421612365bf5aa5fd2f7950057` |
| `potato-android/figma/scene-book-edit.json` | 29226 | `d7a021efdf894e155d96917ffcdb07a1485534bddbb20b0174d35ef74df39bc9` |
| `potato-android/figma/scene-books.json` | 59801 | `e7d764298906ca9ea07cd94e6d4aed91764d3fa5db841a396808809969f26c5f` |
| `potato-android/figma/scene-complete-book.json` | 22803 | `a2d7474d818528613a25fbe8196294c12ba11f1b8f274735c6c49b82c7cf672b` |
| `potato-android/figma/scene-complete-course-success.json` | 16627 | `6cdf4020839b0ea9d29371762bdd7e047034946b6020b01eff6a41efa486c3ee` |
| `potato-android/figma/scene-complete-course.json` | 19144 | `40af0d684fffb4b1822fec765f4ca8c9ad8d5e6c7d6dfd85eeed97db4fc77313` |
| `potato-android/figma/scene-complete-custom-success.json` | 18298 | `96bd651e7134559a6448aaa63eee4d3004de5b291d3bcfa0126fcecf10328d51` |
| `potato-android/figma/scene-complete-custom.json` | 19989 | `d8d419b78e096abd48e54f4cefa41b3d6c80741ae0e628967f6f996be1033c51` |
| `potato-android/figma/scene-complete-success.json` | 14201 | `a64ba526ab1a3a22bf0ec910cb492fb2b23e4f60e613e685c76b11c3e493f6bb` |
| `potato-android/figma/scene-confirm-book.json` | 13323 | `ef18ab77a05afc95bc628e4aeb73dd244df162914cf6a916a4919efdc50d1301` |
| `potato-android/figma/scene-confirm-course.json` | 13169 | `cf92c977e12a3302c80bd464c0776925fdf21e460292b50065c7ed4a9f341d48` |
| `potato-android/figma/scene-confirm-import.json` | 13897 | `5fbc55720776e2d2a7cb2bdc4b69ee906d122c69b6985e6b840765e363b703b4` |
| `potato-android/figma/scene-confirm-logout.json` | 13260 | `19317504983e32375f27570be59348928a30cf150174e6f1b00d619d408e057f` |
| `potato-android/figma/scene-confirm-photo.json` | 13288 | `b8e61d034cf83b2708c2880ef4a0b421aa9f8dfae6e14c07bcd2b3c13048eeb1` |
| `potato-android/figma/scene-confirm-pull.json` | 13945 | `0c2e05c39b2929e315f6a39b4302e4bac77ba567f6b4ee9b5a9081df515faa5d` |
| `potato-android/figma/scene-confirm-reset.json` | 14064 | `8baa279248199b6b8dd6fc0c2dc75e1af159e0422cd50bf9ccbf660f439f1628` |
| `potato-android/figma/scene-confirm-upload.json` | 13873 | `74f4b82636a83661ddebac8bd75a28a82811c7a4e8e38cd380b17f8a9251848a` |
| `potato-android/figma/scene-countdown.json` | 38395 | `0590c2c8250f5a8bbffc9c61c212031c1f354fce70d27d2da5d975d884a05f56` |
| `potato-android/figma/scene-course-add.json` | 28562 | `75e5d5cfbb3ae453f908c7c52f819a4b9ba07527a2054f17594871d0ea08f39e` |
| `potato-android/figma/scene-course-edit.json` | 28316 | `6864a588ee17aea24246bf6605ad02e0c1672dc0ee7fdc63e5de5bd621f9b26b` |
| `potato-android/figma/scene-courses.json` | 55476 | `a4bb20b38fc7ca77d1c5bd5d32ac676e70e2d158cf3bd192bafd370e9e11c227` |
| `potato-android/figma/scene-custom-add.json` | 22867 | `afbcfb93fcb546e72db719203d5148acb5c592577641ae5f96e39a87f7a46165` |
| `potato-android/figma/scene-delete-confirm.json` | 41330 | `969955476df7eac4218a787574b9b9a08895ff99c8cf0138b75aa5ea462dd53e` |
| `potato-android/figma/scene-download-apk.json` | 21600 | `cff3bdced94037a177084645bbec82fa533433715d139e0961d6037b4c5b8b04` |
| `potato-android/figma/scene-focus-course.json` | 17854 | `ecf5b45cbeeeb5494097e1d11f4e7c40c81f58d42716ecd2e6fe60a01a5fc803` |
| `potato-android/figma/scene-focus-custom.json` | 17840 | `057940417de99f9f41e376feb5f166d8bae2314b3d8533a8d9a706d932ded543` |
| `potato-android/figma/scene-focus-paused.json` | 21838 | `14a77967362da882af5c37fb318c22648fd4d03cd6a3a685a171ca8f0e1c6379` |
| `potato-android/figma/scene-focus.json` | 19748 | `beb4ae8c55e3a6514e0f73b082d312c3baf24f1563e6ea03399701e5dee0edab` |
| `potato-android/figma/scene-guest.json` | 35214 | `933afa67ec5f3312c2a9267feb8bef1a192af9979e8c4353cf9013cd12666fc1` |
| `potato-android/figma/scene-library.json` | 48329 | `12f5ed6a5283b2f355750b2b652d54eeafb274feb92d333be6ff3ed546d29469` |
| `potato-android/figma/scene-login.json` | 20857 | `9cb5d92ce5146118bc37ea06fa2f8e8825d0687edb73ecd3d02ff3415718139c` |
| `potato-android/figma/scene-month-picker.json` | 24285 | `018b8b6a73ba8d4d328a54572455f2f37b69429a1ffd46f17cc12e0fca572f1c` |
| `potato-android/figma/scene-monthly.json` | 51189 | `d918aa374c4e9ea5dd0bf4ee3e1e1cab9a6249738d2af48485e313932e8aec2c` |
| `potato-android/figma/scene-overall-legend.json` | 44280 | `1bfc4f935fdb0edfae6a1d6e572bc3a799cb770a776a917f5401098a157b8e6d` |
| `potato-android/figma/scene-overall.json` | 51295 | `4c5aaa8cde39ab1fede7713f99df77f13fd34b1c8f41a3b47fc669b02737364a` |
| `potato-android/figma/scene-photo-import.json` | 44415 | `5d45b16e4dd76597d115a03dc8e16efbffff782fcb5d45f022b6fcd1f27ab693` |
| `potato-android/figma/scene-profile.json` | 17514 | `baea5bdac9d604e10200afb8222bd8f14858a5ea983529c8cb8cfccb64198129` |
| `potato-android/figma/scene-register.json` | 20150 | `e22b57a1a8a584bbaa0ef18c3b4891c621a7460332d46e3d8c0949c8df86e1b5` |
| `potato-android/figma/scene-settings.json` | 42107 | `7f0ca488abf8c45c7de14df954441a670724391f4f5d26dac9f1dcde2dbc11c0` |
| `potato-android/figma/scene-states-empty.json` | 43953 | `1affc253231ff8669293f4c8bf7d207625db9e86deec2081081c139857222584` |
| `potato-android/figma/scene-states-form.json` | 70988 | `055d7235946e4778212eda1c65c30bfa6c62f1a9a94d35cf0b0ece0bf1850f05` |
| `potato-android/figma/scene-states-sync.json` | 30400 | `def941253c190b6827ac805df5c9b8de75754657641876e6d040702fd251e3bb` |
| `potato-android/figma/scene-sync.json` | 25341 | `2d05f939885ed7ac4a8a3bdaeeb9ed19777c5bbe2b6c480d7a52bf893b3150ab` |
| `potato-android/figma/scene-today-empty.json` | 31052 | `a25208cac02acbaf99810486a9badaef5621e487d4ff2313a491b7f3534ad458` |
| `potato-android/figma/scene-today-multi.json` | 56016 | `969123d8fd6f069c3a768b00bb52af4a99581de962cd0662a7fc3879bb5a0a67` |
| `potato-android/figma/scene-today.json` | 49134 | `bc89b5b01d472696214d65cc1b37fffc13deee9cf3d8e1184f33629b855803ce` |
| `potato-android/figma/scene-wrong-detail.json` | 25804 | `d3a7110e88805a67233dff2b0f4aff4b71b03fc45643da5daf2a159f37a28940` |
| `potato-android/figma/scene-wrong.json` | 60709 | `f019d3804c485caa813f9acf7b53017c7aa65c0967e864f9694d805ce7e8b3e0` |
| `potato-android/figma/scenes-cli.txt` | 1512757 | `1a6a8a1167c7375705e0729fd9b2166a0cd8a4e88bfded13199452e712749cca` |
| `potato-android/figma/scenes.json` | 1499512 | `abf3b035b11375975098eae6938b7edace0b5194a7f9642cb69fead2c1c60fa2` |
| `potato-android/figma/section-handoff.json` | 5704 | `3dc8fae71328073dabae6c409ab12c88bed132be0980464649bc3ef9c9f53711` |
| `potato-android/figma/state.json` | 12952 | `f2217c44f8cfffa79b1cc1048a10647043d1fd65a9639d1e10a94cfbff290421` |
| `potato-android/assets/potato-poses.png` | 1033917 | `5601594061c5df1d3f9ea50fa5c38fa2957dbc9dbb68c9dc9d895a38d1583dde` |