# 分布式存储集群

## 更新日期 2025-04-21

## 各方案的独立分仓库
| 方案 | worker 文件 | 同步仓库模版 | 视频教程 |
| --- |--- |--- |--- |
| GitHub only | [worker.js](https://raw.githubusercontent.com/fscarmen2/pic-hosting-cluster/refs/heads/main/cloudflare_worker/github_only.js) | [博文 7.2 Github 设置](https://www.fscarmen.com/2024/10/blog-post.html) | https://youtu.be/eRqIpeeo9SA |
| GitLab only |[worker.js](https://raw.githubusercontent.com/fscarmen2/pic-hosting-cluster/refs/heads/main/cloudflare_worker/gitlab_only.js) | 使用 GitLab 平台自带的镜像功能 | https://youtu.be/tjiI3I3MkaQ |
| GitHub + GitLab | [worker.js](https://raw.githubusercontent.com/fscarmen2/pic-hosting-cluster/refs/heads/main/cloudflare_worker/github_gitlab_r2_b2.js) | [点击使用模板库，注意需要手动改为私有仓库](https://github.com/new?template_name=files-hosting-template-1&template_owner=fscarmen2) | https://youtu.be/SGex7xJ9YdQ |
| R2 + GitHub + GitLab | [worker.js](https://raw.githubusercontent.com/fscarmen2/pic-hosting-cluster/refs/heads/main/cloudflare_worker/github_gitlab_r2_b2.js) | [点击使用模板库，注意需要手动改为私有仓库](https://github.com/new?template_name=files-hosting-template-2&template_owner=fscarmen2) | https://youtu.be/5i-86oBLWP8 |
| B2 + R2 + GitHub + GitLab | [worker.js](https://raw.githubusercontent.com/fscarmen2/pic-hosting-cluster/refs/heads/main/cloudflare_worker/github_gitlab_r2_b2.js) | [点击使用模板库，注意需要手动改为私有仓库](https://github.com/new?template_name=files-hosting-template-2&template_owner=fscarmen2) | https://youtu.be/4X1FjLCAckI |

## GitHub --→ GitLab 目录下1个文件，放到 GitHub 库: 
- **AC 脚本**: `.github/workflows/cluster_sync.yml`

## GitLab --→ GitHub 目录下3个文件，放到 GitLab 库: 
- **配置文件**: `config.yml`
- **同步脚本**: `sync_to_github.sh`
- **CI/CD 脚本**: `.gitlab-ci.yml`

## R2 --→ GitHub 目录下1个文件，放到 GitHub 库: 
- **AC 脚本**: `.github/workflows/r2_to_github.yml`
- **设置3个secrets**: `ACCOUNT_ID`, `WORKER_NAME` 和 `API_TOKEN`

## S3 (R2+B2) --→ GitHub 目录下1个文件，放到 GitHub 库: 
- **AC 脚本**: `.github/workflows/s3_to_github.yml`
- **设置3个secrets**: `ACCOUNT_ID`, `WORKER_NAME` 和 `API_TOKEN`

## ACCOUNT_ID,WORKER_NAME,API_TOKEN 获取方式

### 在 Cloudflare 面板创建可以读取 Worker 项目的 API, https://dash.cloudflare.com/profile/api-tokens

![image](https://github.com/user-attachments/assets/9e49b29a-54ae-46f0-aeda-28d95f4a9041)
![image](https://github.com/user-attachments/assets/11dceb4b-ab2e-41a8-b8e4-7317bcf4b50f)
![image](https://github.com/user-attachments/assets/b1e6f1c3-3d8d-4ba3-8d98-35ab4f061b14)
![image](https://github.com/user-attachments/assets/81e66642-cd5c-43d3-bb72-7fecf24e16a3)
![image](https://github.com/user-attachments/assets/3c832e81-bfc6-480d-939c-1d0731a07c17)

### 在 Action 处设置 3 个 secret 变量

![image](https://github.com/user-attachments/assets/25b8d0fa-8302-4cb9-a6db-83e449e9664c)

## Cloudflare worker 目录下3个文件，复制代码到 worker 处：
- **只使用 GitHub**: `github_only.js`
- **只使用 GitLab**: `gitlab_only.js`
- **同时使用 GitHub 和 GitLab**: `github_gitlab_r2_b2.js`
- **同时使用 GitHub, GitLab 和 R2**: `github_gitlab_r2_b2.js`
- **同时使用 GitHub, GitLab，R2 和 B2**: `github_gitlab_r2_b2.js`

## 检测节点状态 `https://<自定义域名>/<自定义密码>`

<img width="670" alt="image" src="https://github.com/user-attachments/assets/7a518dfc-7c56-4c30-bd23-d2766f39a3a8">

## 检测文件信息
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=where`

## 指定文件获取平台
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=github`

- **从 GitLab 获取** `https://<自定义域名>/<文件名>?from=gitlab`

- **从 Cloudflare R2 获取** `https://<自定义域名>/<文件名>?from=r2`

- **从 Backblaze B2 获取** `https://<自定义域名>/<文件名>?from=b2`

## 从所有的平台删除指定文件

- **支持同时在 GitHub / GitLab / R2 / B2 多级子目录下的文件** ``https://<自定义域名>/<自定义密码>/del?file=<文件名>`

- **举例** 定义的节点目录为 files，而需要删除 `<节点>/files/a/b/test.jpg`

```
# 以下两个路径都可以
https://<自定义域名>/<自定义密码>/delete?file=a/b/test.jpg
https://<自定义域名>/<自定义密码>/del?file=/a/b/test.jpg
```

![image](https://github.com/user-attachments/assets/ccbd96df-f930-490b-a947-8df9dd9b8459)

## Sponsors

- This project is generously sponsored by [VTEXS](https://zmto.com/).

- 感谢 vps.town 对本项目的支持和赞助

<a href="https://vps.town" align="left">
  <img src="https://vps.town/static/images/sponsor.png" alt="Sponsor" width="30%">
</a>

- 感谢 digitalvirt.com 对本项目的支持和赞助

<a href="https://digitalvirt.com" align="left">
  <img src="https://digitalvirt.com/templates/BlueWhite/img/logo-dark.svg" alt="Sponsor" width="30%">
</a>

- 感谢 dartnode.com 对本项目的支持和赞助

<a href="https://dartnode.com?aff=CraftyMouse750" target="_blank" align="left">
  <img src="https://status.dartnode.com/upload/logo1.png" style="width:20%;">
</a><br>

<a href="https://dartnode.com" title="Powered by DartNode - Free VPS for Open Source" target="_blank" align="left">
  <img src="https://dartnode.com/branding/DN-Open-Source-sm.png" style="width:40%;">
</a>

I am honored that DARTNODE is offering a free server to sponsor my project.<br>
DARTNODE's official Web Site : [https://dartnode.com](https://dartnode.com?aff=CraftyMouse750)
