# Nginx 配置

生产环境由 Nginx 容器终止 HTTPS，并代理前端、API 和上传文件。

- `templates/https.conf.template`：首次生产部署使用的 HTTPS 模板。将 `__FAE_DOMAIN__` 替换为证书域名，将 `__FAE_PUBLIC_URL__` 替换为公网访问地址，再写入服务器 `/opt/fae/nginx/conf.d/default.conf`。
- `conf.d/default.conf`：不依赖证书的 HTTP 配置，供本地 HTTP 验收参考；生产 HTTPS 部署使用上面的模板生成配置。

`compose.prod.yml` 将服务器 `nginx/conf.d` 挂载到容器，并只读挂载 `/etc/letsencrypt/live` 和 `/etc/letsencrypt/archive`。先在 Ubuntu 宿主机申请证书，再启动生产服务。证书不存放在项目内，Cloudflare 凭据不挂载给 Nginx。

宿主机 Certbot 定时续期后，通过 deploy hook 执行容器中的 `nginx -t` 和 `nginx -s reload`，使新证书生效。

Win11 日常开发继续使用 `docker-compose.yml`；生产 Compose 的证书目录针对 Ubuntu 宿主机。
