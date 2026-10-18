# 知序 · 初中学习伙伴

基于 Pi Agent 的家庭教育系统，以聊天为首页。学生可以自由提问、拍照发题、连续追问；小直先讲思路，再陪学生尝试和核对。

## 已有功能

- 手机号与密码注册、登录、管理员重置密码；每个账号独立保存数据。
- 多轮文字和图片问答，单条消息最多附 9 张作业照片（每张压缩后不超过 10 MB，合计不超过 30 MB）；可以一次多选，也可以连续拍照后一起发送。整套卷子超出单批限制时分批发送，等待回复时也可以继续追问。
- 已接入服务端自动学习配图能力：配置 OpenAI Image API Key 后，小直会在讲解后为实质性的学习问题生成一张图解；聊天大模型仍使用当前配置。未配置图片 Key 时，讲解照常完成。
- 学习伙伴昵称、头像、主题、聊天背景、朗读声音和语速设置。
- 豆包语音从「小何、Vivi、咪仔、桃子、梓梓」中随机朗读，支持暂停、继续和停止；聊天和设置试听使用同一规则。
- 根据作答内容给予具体鼓励，核对正确后显示礼花和短庆祝音乐，可单独关闭。
- 学习档案和近期作答证据；家长关联后可回看孩子的完整学习过程。
- 本地试卷 PDF 索引和受保护下载。实际试卷和家庭数据不在仓库中。

## 本地运行

需要 Node.js 22.19 或更高版本。

```sh
npm ci
npm run build
cp .env.example .env.education.local
# 编辑 .env.education.local，填写所使用模型的 Key
npm run dev
```

打开 `http://127.0.0.1:3018/`。模型密钥由服务端读取，不发送到浏览器。也可通过 `CUIYI_SOURCE_DIR` 复用现有导演台的模型配置。

管理员通过 `EDU_ADMIN_PHONE` 和 `EDU_ADMIN_INITIAL_PASSWORD` 初始化，首次登录须修改密码。部署到 HTTPS 后设置 `EDU_COOKIE_SECURE=true`。

朗读需要独立的豆包语音 Key：在 `.env.education.local`、`.env.media.local` 或服务器环境中填写 `DOUBAO_TTS_API_KEY`，并开通豆包语音 2.0 资源。已有非空环境变量优先。服务端使用 `seed-tts-2.0` 资源和固定音色清单，通过认证接口返回 MP3，Key 不下发客户端。旧设备音色设置会自动切换为随机选择；语音失败时显示错误，不替换为设备声音。生成结果只在服务进程内按账号缓存 10 分钟，暂停和继续会复用已有音频。音色编号对应火山引擎[官方音色列表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)。

自动配图需要服务端 Image API Key：在本地 `.env.media.local` 或 `.env.education.local` 中设置 `OPENAI_IMAGE_API_KEY`，线上则设置在服务端的运行环境文件中；可用 `OPENAI_IMAGE_MODEL` 调整图像模型。不要把 Key 提交到 GitHub。多页作业图片经过浏览器压缩后随聊天消息上传，服务端和 Nginx 都允许最大 45 MB 的请求体。

## 测试

```sh
npm test
```

浏览器测试需要本机安装 Google Chrome。测试使用临时数据库和合成资料，不依赖真实家庭数据或题库，也不调用收费模型。

## 部署

`deploy/zhixu-study.service` 和 `deploy/nginx.conf` 提供现有部署配置示例，需按实际目录和域名调整。使用独立系统用户运行，把数据库放在版本目录之外，通过环境变量指定：

- `EDU_DATA_DIR`：学习数据库、上传照片。
- `EDU_ARCHIVE_DIR`：试卷文件及 `download-manifest.json`。
- `EDU_HOST`、`EDU_PORT`：服务监听地址。

`scripts/prepare-deploy.py` 是本地打包工具，会包含本地题库和学习快照，生成的包仅供私有部署，不应上传公共仓库。密钥、数据库、账号资料、试听文件和部署记录均通过 `.gitignore` 排除。

## 当前边界

第一版注册不发送短信。知识点诊断依赖已有作答证据，不把一次错误作为长期结论。聊天中的正确性判断由模型核对，仍可能出错；数值练习另有确定性判分。

视频仍在接入。试卷仍以整卷 PDF 为主，尚未完成全部单题拆分与标注。
