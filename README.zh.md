# Jade Garden — 网站、在线点餐、POS 与厨房系统

[English](README.md) · **中文**

> 本文件与 [README.md](README.md) 内容一一对应。修改其中一份时请同步另一份。命令、文件名、字段名保持英文原样。

Jade Garden 餐厅(471 Main St N, Moose Jaw, SK)整套系统运行在 **一个 Cloudflare Worker + 一个 D1 数据库** 上:

- **顾客网站**(`/`、`/order/`、`/gallery/`、`/privacy/`):Astro 静态站,支持自取/外送在线点餐、优惠券,可选 Google/Apple/Facebook 登录。
- **员工端**(`/staff/`;`/staff/pos/` 打开点餐,`/staff/kitchen/` 打开厨房):iPad POS(电话、到店、堂食桌位)、收银(现金/刷卡、分单、小票)、带提示音的厨房出单屏、菜单设置(菜品选项、售罄、套餐内容),由 Cloudflare Access 保护。旧版界面保留在 `/staff/classic/`。
- **API**(`/api/*`):服务端定价、订单、顾客、优惠券、支付回调。
- **在线支付**:Clover Hosted Checkout(顾客在 Clover 的页面付款,卡号不经过我们的代码)。
- **WooCommerce 导入**(临时):在切换前,把旧 WordPress 站的订单同步进厨房看板。

> **本文件是交接指南。** 详细的工程规范(规则、API、数据模型、促销手册)在 [AGENTS.md](AGENTS.md)(英文)。如果你使用 AI 编程助手,请让它先读 AGENTS.md。

---

## 1. 当前状态(交接快照)

| 项目 | 状态 |
|---|---|
| 网站、点餐、POS、厨房看板、优惠券 | 已完成,本地测试通过(`npm test` 及端到端冒烟测试) |
| 新版员工端(堂食桌位、收银分单、菜品选项、售罄) | 2026-11 完成,本地测试通过;**尚未部署**。部署时会执行迁移 `0005` |
| 测试部署 | 之前部署在前任开发者的 Cloudflare 账号下(`jg.moosephotoprint.com` 和一个 `workers.dev` 地址) |
| Clover 支付 | **仅沙盒。** 之前的密钥被拒绝(见 §8)。在配置真实 Clover 密钥之前,生产环境会拒绝网上订单 |
| 顾客登录(Google/Apple/Facebook) | 未配置,目前只支持访客结账 |
| Turnstile(防机器人) | 未配置 |
| 域名 `mjjadegarden.com` | 已转到 Cloudflare,目前仍指向旧 WordPress。计划:先放在 `w2.mjjadegarden.com`,稳定后再把 `www` 指过来(§7) |
| 照片 / 菜品描述 | 只使用餐厅自己的照片;还有 67 道菜没有照片 |

**域名已经在你的 Cloudflare 账号里,所以要把整套系统部署到你自己的账号。** 不要沿用前任的 D1 id、Access 应用或 token,按 §4 全部替换。

---

## 2. 需要准备的账号

1. **Cloudflare**(域名所在账号):Workers、D1、Zero Trust(Access,免费版即可)、Turnstile。
2. **Clover** 商户账号(已开通 Ecommerce / Hosted Checkout)。
3. **GitHub**(代码仓库)。
4. 可选:Google / Apple / Facebook 开发者账号(若要开启社交登录)。

本机工具:Node.js 20+ 和 npm、git。(Python 3 仅用于 `tools/` 里的可选脚本。)

---

## 3. 项目结构

```
AGENTS.md            工程规范:规则、架构、API、数据模型、促销手册(英文)
README.md / README.zh.md   本交接指南(英文 / 中文)
TODO.md              较大待办项的详细方案(顾客邮件)
wrangler.jsonc       Worker 配置:静态资源、D1 绑定、定时任务、路由、公开变量(不含密钥)
package.json         npm 脚本(dev、test、build、deploy、db:*)
scripts/deploy.sh    生产部署:setup | deploy | status | rollback
data/
  menu.json          菜品、价格、图片的唯一数据源(网站、API、服务端定价都读它)
  moose_jaw_streets.json, moose_jaw_hotels.json   POS 地址自动补全
migrations/          D1 表结构,每次变更一个文件(0001_init.sql ...)。已应用的文件不要改
seed/dev.sql         仅本地使用的示例优惠券
worker/              后端(Cloudflare Worker)
  index.js           路由 + 定时任务入口
  routes/            public.js、account.js、staff.js、webhooks.js
  services/          pricing.js、coupons.js、orders.js、customers.js、clover.js、combos.js、woocommerce.js(含测试)
  auth/              staff.js(Cloudflare Access JWT)、session.js、providers.js
  lib/               http、util(税、时区、电话)、menu
web/                 顾客网站(Astro),构建输出到 web/dist
  src/data/site.js   地址、电话、营业时间、首页推荐菜
  src/content/promotions/   每个在线促销一个 .md 文件(见 §6)
  src/pages/ components/ scripts/ styles/ lib/
  public/staff/index.html   员工 POS + 厨房应用(单个原生 HTML 文件)
  public/images/menu/       <menuId>.webp 与 <menuId>-sm.webp 菜品图
  public/images/site/       首页大图、故事、相册图片
docs/architecture_and_guide.md   POS 搜索、打印机硬件、切换流程
tools/               可选的离线 Python 辅助脚本(WooCommerce 检查、旧站图片导入)
```

整体原理:浏览器从 `web/dist` 加载静态页面;`/api/*` 由 `worker/index.js` 处理并读写 D1。定时任务**每分钟**运行一次,用于让未付款的 Clover 结账过期,以及(切换前)导入 WooCommerce 订单。员工页面和 `/api/staff/*` 在 Cloudflare Access 保护之下。

---

## 4. 在你自己的 Cloudflare 账号中首次部署

### 4.1 先在本地跑起来

```bash
git clone https://github.com/mice2100/mjjg.git && cd mjjg
npm install
cp .dev.vars.example .dev.vars          # 保持 ENVIRONMENT=development(本地跳过员工登录)
npm run db:migrate && npm run db:seed   # 本地 D1
npm run dev                             # http://localhost:8787  (/、/order/、/staff/)
npm test
```

### 4.2 Cloudflare API token

Cloudflare 控制台 → My Profile → API Tokens → Create Token → 选 **Edit Cloudflare Workers** 模板,再加上 **Account › D1 › Edit**。若要通过 `routes` 绑定自定义域名,还要加 `mjjadegarden.com` 这个 zone 的 **Zone › Workers Routes › Edit**。然后:

```bash
cp .deploy.env.example .deploy.env      # 填 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID
```

(也可以两项都留空,改用 `npx wrangler login` 浏览器登录。)`.deploy.env`、`.prod.vars`、`.dev.vars`、`.env` 都已被 git 忽略,**绝对不要提交**。

### 4.3 按你的账号修改 `wrangler.jsonc`

| 设置 | 怎么做 |
|---|---|
| `d1_databases[0].database_id` | `npm run deploy:setup` 会在你的账号里查找或创建 `jadegarden-db`,并自动写入新 id |
| `routes` | 目前是旧测试域名 `jg.moosephotoprint.com`。分阶段上线时改成 `w2.mjjadegarden.com`(见 §7) |
| `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` | 换成你自己的 Zero Trust 值(步骤 4.5) |
| `CLOVER_MERCHANT_ID`、`CLOVER_ENV` | 你的 Clover merchant UUID,以及 `sandbox` 或 `production`(步骤 4.6) |
| `PUBLIC_SITE_URL`、`WC_STORE_URL` | `https://mjjadegarden.com` |
| `ADMIN_EMAILS` | 允许在员工端编辑套餐内容的邮箱。留空 = 所有员工都可编辑 |

### 4.4 首次部署

```bash
npm run deploy:setup
```

它会创建 D1 数据库、执行迁移、在 `.prod.vars` 里生成 `SESSION_SECRET` 并部署。之后网站就能通过 `jadegarden.<你的子域>.workers.dev` 访问。

### 4.5 保护员工端(Cloudflare Access)

Zero Trust → Access → Applications → 添加 **self-hosted** 应用。在你的域名下加两个路径:`/staff/*` 和 `/api/staff/*`。策略:允许员工邮箱(可用一次性 PIN 登录)。把 **team domain**(`xxxx.cloudflareaccess.com`)和应用的 **AUD tag** 填入 `wrangler.jsonc` 的 `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`,然后 `npm run deploy`。在配置好之前,员工 API 会拒绝所有请求(这是故意的:出错时默认拒绝)。

### 4.6 Clover(在线支付)

1. 找到 **13 位字符的 merchant UUID**(在商户后台网址里)。它**不是**数字形式的 MID。填入 `CLOVER_MERCHANT_ID`。
2. 商户后台 → Account & Setup → Ecommerce API Tokens → 创建 **private token** → 填入 `.prod.vars` 的 `CLOVER_PRIVATE_KEY`。
3. Ecommerce → Hosted Checkout → 把 webhook 地址设为 `https://<你的域名>/api/webhooks/clover`,点击 Generate,把 Signing Secret 存为 `CLOVER_WEBHOOK_SECRET`。Clover 自带的小费功能要保持**关闭**:小费在我们网站上选。
4. 先在 `sandbox` 用 Clover 测试卡测试。正式上线前把 `CLOVER_ENV` 改成 `production`,用真实卡下一单 $1 的订单,再到 Clover 里退款。

### 4.7 其他密钥(`.prod.vars`)

把 `.prod.vars.example` 复制为 `.prod.vars`。留空的行表示保留 Cloudflare 里已有的值。

| 密钥 | 用途 |
|---|---|
| `SESSION_SECRET` | 由 setup 生成。更换它会让所有顾客退出登录 |
| `CLOVER_PRIVATE_KEY`、`CLOVER_WEBHOOK_SECRET` | 在线支付 |
| `TURNSTILE_SECRET_KEY`(+ 公开变量 `TURNSTILE_SITE_KEY`) | 结账防机器人。为你的域名创建 Turnstile 组件 |
| `FACEBOOK_APP_SECRET` | 仅在使用 Facebook 登录时 |
| `WC_CONSUMER_KEY`、`WC_CONSUMER_SECRET`、`WC_WEBHOOK_SECRET` | 仅在 WordPress 关闭之前需要 |

---

## 5. 部署更新

```bash
npm test && npm run build     # 自检
git commit -am "..."          # deploy 会拒绝未提交的改动
npm run deploy                # 测试、构建、备份 D1 到 backups/、有待执行迁移则应用、部署、冒烟测试
npm run deploy:status         # 查看版本、密钥、待执行迁移
npm run deploy:rollback       # 只回滚代码,从不回滚 D1
```

因为回滚不会动数据库,所以**迁移必须是向后兼容的**(只新增表/列;旧代码在新表结构上仍要能运行)。

---

## 6. 日常操作(无需开发者)

**改价格或加菜:** 编辑 `data/menu.json`,然后 `npm run deploy`。不要重新编号;新菜用新 id;下架菜品就删除它(旧订单保留自己的副本)。

**加菜品图片:** 转成 WebP,保存为 `web/public/images/menu/<id>.webp`(1200px)和 `<id>-sm.webp`(480px),再在 `menu.json` 里给该菜加上 `"image": "/images/menu/<id>.webp"`。
`magick in.jpg -auto-orient -strip -resize 1200x1200\> -quality 80 out.webp`。只发布餐厅**自己拍**的照片,不要用图库图片,也不要用能认出顾客的照片。

**改营业时间、地址、电话:** `web/src/data/site.js`。

**在网站上宣传促销:** 复制 `web/src/content/promotions/_example.md` 为新文件,编辑后部署。开始和结束日期会自动生效。删除该文件即下线促销。

**发放折扣(优惠券):** 一条 SQL 即可,无需部署:

```bash
npx wrangler d1 execute jadegarden-db --remote --command "INSERT INTO coupons (...) VALUES (...)"
```

完整字段说明和可直接修改的示例见 [AGENTS.md §7](AGENTS.md#7-promotions--coupons-playbook)。停用优惠券:`UPDATE coupons SET is_active = 0 WHERE code = 'X'`。

**邮件列表(仅限已同意订阅的顾客,CASL 要求):**
`SELECT email, name FROM customers WHERE marketing_opt_in = 1`

**已付款网上订单退款:** 在 Clover 后台手动退款。厨房里点“取消”**不会**退款。

**添加员工:** 在 Zero Trust 的 Access 策略里加上他的邮箱。

**售罄 / 恢复供应:** 员工端 → Menu → 点菜品旁的 Available / Sold out。网站会同时停止售卖该菜品,无需部署。

**菜品选项(辣度、要求等):** 员工端 → Menu → Item options。只有 `ADMIN_EMAILS` 里的邮箱可以修改(留空 = 所有员工)。

---

## 7. 上线计划:先放 `w2.mjjadegarden.com`,稳定后再切 `www`

域名已在 Cloudflare 上,所以分两个阶段上线。在新站证明稳定之前,WordPress 继续为 `www.mjjadegarden.com` 和 `mjjadegarden.com` 提供服务。

**阶段 1:在 `w2.mjjadegarden.com` 试运行(不动 WordPress)**

1. 在 `wrangler.jsonc` 把 `routes` 设为 `[{ "pattern": "w2.mjjadegarden.com", "custom_domain": true }]`,然后 `npm run deploy`。Wrangler 会自动创建 DNS 记录和证书。(`PUBLIC_SITE_URL` 可以保持 `https://mjjadegarden.com`。)
2. 把 `w2.mjjadegarden.com` 加进 Access 应用(§4.5)和 Turnstile 组件的主机名。
3. 把 Clover webhook 设为 `https://w2.mjjadegarden.com/api/webhooks/clover`(WooCommerce webhook 设为 `https://w2.mjjadegarden.com/api/webhooks/woocommerce`)。
4. 测试期间保持 `CLOVER_ENV=sandbox`:下单、用测试卡付款、在 `/staff/kitchen/` 看到订单并标记完成。店主在此审阅文案、营业时间、价格、隐私政策和照片。
5. 让员工真实使用 `https://w2.mjjadegarden.com/staff/pos/` 和 `/staff/kitchen/`(电话订单,以及由定时任务导入的 WordPress 订单)。这样运行到确认稳定为止。

**阶段 2:正式切到 `www`**

1. 把 `CLOVER_ENV` 改为 `production`,换成正式的 merchant id、`CLOVER_PRIVATE_KEY` 和 `CLOVER_WEBHOOK_SECRET`。
2. 在 Cloudflare DNS 里**删除 `www` 和根域名上指向 WordPress 的记录**(自定义域名不能压在已有记录之上)。请选在生意清淡时段操作:从删除到部署完成这段时间,旧站是不可用的。
3. 把 `routes` 设为 `www.mjjadegarden.com` 和 `mjjadegarden.com`(都带 `custom_domain: true`;想保留 `w2` 作为备用也可以),然后 `npm run deploy`。
4. 把 Access 应用、Turnstile 主机名、Clover 和 WooCommerce 的 webhook 地址更新为新域名。
5. 用真实卡下一单 $1 的订单,并在 Clover 里退款。
6. 稳定运行几天后清理:删除 `scheduled()` 里的 WooCommerce 部分、`worker/services/woocommerce.js`、`worker/routes/webhooks.js` 里的 WooCommerce 处理(**保留 Clover webhook 和定时任务**)以及 `WC_*` 密钥,然后关闭 WordPress。

旧 WordPress 网址由 `web/public/_redirects` 做跳转。

---

## 8. 已知问题与必须处理的事项

1. **轮换 WooCommerce API 密钥。** 一个旧密钥曾被提交到*之前那个仓库*的历史里。本仓库使用全新的单提交历史发布,但这个旧密钥在 WordPress 上仍然有效。请在 WordPress 创建新的**只读**密钥,删除旧的,并把新的填入 `.prod.vars`。
2. **Clover 密钥:** 之前的密钥返回 401,原因是用了数字形式的 MID,而不是 13 位 merchant UUID。按 §4.6 重新创建。
3. **Access 和 Turnstile** 必须先在你的账号里配置好,网站才能正式使用(§4.5、§4.7)。
4. **接单限制:** 网上订单目前不会在营业时间之外或周一被拒绝。
5. **店主内容审核:** 营业时间、外送范围、隐私政策、菜品描述(`menu.json` 的 `description` 字段)、以及还没有照片的菜品。

## 9. 待办(尚未开发)

订单确认邮件和优惠券营销活动(见 `TODO.md`)、“预约稍后取餐”、POS 来电显示弹出(`/staff/#call=<号码>`)、厨房打印机桥接(见 `docs/architecture_and_guide.md`)、邮件链接登录和 `/account/` 页面、员工端菜单编辑器(把菜单迁入 D1)。完整列表见 [AGENTS.md §12](AGENTS.md#12-open-items--backlog-priority-order)。

## 10. 必须遵守的规则(详见 AGENTS.md §2)

- 所有顾客端和员工端的界面文字**必须是英文**。不要把中文对话内容复制进产品里。
- **价格由服务端决定。** 绝不信任浏览器传来的价格或总额。
- 金额一律用**整数分(cents)**。时间以 UTC 存储;业务逻辑使用 `America/Regina` 时区。
- **密钥不进 git。** 使用 `.dev.vars`、`.prod.vars`、`.deploy.env` 或 `wrangler secret put`。
- 表结构变更只能**新增文件**到 `migrations/`,不要修改已应用的迁移。
- 促销位为空时必须安全:没有任何促销,网站也要能正常上线。

## 11. 故障排查

| 现象 | 可能原因 |
|---|---|
| `/staff/` 先出现 Cloudflare 登录,随后 `/api/staff/*` 返回 401/403 | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` 填错,或 Access 应用没有同时覆盖 `/staff/*` 和 `/api/staff/*` |
| 结账返回 503 | 生产环境没有 `CLOVER_PRIVATE_KEY` |
| 结账返回 502 | Clover 拒绝了请求:检查 merchant UUID、token、环境 |
| 顾客已付款但订单一直是 “awaiting” | webhook 地址或 `CLOVER_WEBHOOK_SECRET` 不对。定时任务每分钟也会向 Clover 支付 API 核对,作为备份 |
| 本地网站显示旧页面 | `wrangler dev` 使用启动时的 `web/dist`:先 `npm run build` 再重启 |
| deploy 拒绝运行 | 有未提交的改动(先提交),或测试失败 |

更多细节:[docs/architecture_and_guide.md](docs/architecture_and_guide.md)(POS 搜索算法、街道自动补全、打印机硬件、切换流程)。
