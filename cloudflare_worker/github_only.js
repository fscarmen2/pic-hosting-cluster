// 用户配置区域开始 =================================

const CONFIG = {
  GITHUB_USERNAME: '', // GitHub 用户名
  GITHUB_PAT: '',     // GitHub PAT 令牌（Personal Access Token）
  GITHUB_REPO_PREFIX: '', // 仓库前缀，不要跟数字，需要结合仓库数量 REPO_COUNT 使用，比如 pic
  REPO_COUNT: 10,        // 仓库数量，比如填10，结合前缀即为 pic1, pic2, ..., pic10
  BLACKLISTED_REPOS: [], // 定义黑名单的仓库序号，只填序号，中间用英文逗号隔开，比如[2,5]，不请求 pic2 和 pic5
  DIR: '',         // 仓库中的目录路径
  CACHE_MAX_AGE: 31556952, // 缓存时间（1年）
  CHECK_PASSWORD: ''     // 用户设置的密码，用于状态检测功能，区分大小写，如未设置则使用 GITHUB_PAT
};

// 用户配置区域结束 =================================

// 生成可用仓库列表
const REPOS = Array.from({ length: CONFIG.REPO_COUNT }, (_, i) => i + 1)
  .filter(index => !CONFIG.BLACKLISTED_REPOS.includes(index));

// 文件大小格式化函数
function formatSize(sizeInBytes) {
  if (sizeInBytes >= 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (sizeInBytes >= 1024) {
    return `${(sizeInBytes / 1024).toFixed(2)} kB`;
  } else {
    return `${sizeInBytes} bytes`;
  }
}

// 获取 GitHub 用户名的异步函数
async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user';  // GitHub 用户信息 API 地址
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,  // 使用个人访问令牌进行授权
        'Accept': 'application/vnd.github.v3+json',  // 指定接受的响应格式
        'User-Agent': 'Cloudflare Worker'  // 用户代理
      }
    });

    // 如果响应状态为 200，表示成功
    if (response.status === 200) {
      const data = await response.json();  // 解析 JSON 数据
      return data.login;  // 返回用户登录名
    } else {
      console.error('GitHub API Error:', response.status);  // 记录错误状态
      return 'Unknown';  // 返回未知状态
    }
  } catch (error) {
    console.error('GitHub request error:', error);  // 记录请求错误
    return 'Error';  // 返回错误状态
  }
}

// 检查 GitHub 仓库的异步函数
async function checkGitHubRepo(owner, repo, pat, dir) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}`; // 直接检查指定目录

  const headers = {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare Worker'
  };

  try {
    // 并发请求获取仓库信息和目录内容
    const [repoResponse, contentsResponse] = await Promise.all([
      fetch(repoUrl, { headers }),
      fetch(contentsUrl, { headers })
    ]);

    const repoData = await repoResponse.json();

    if (repoResponse.status !== 200) {
      throw new Error(`Repository error: ${repoData.message}`);
    }

    // 如果目录不存在或无法访问
    if (contentsResponse.status !== 200) {
      return {
        status: `working (${repoData.private ? 'private' : 'public'})`,
        fileCount: 0,
        fileSize: 0
      };
    }

    const contentsData = await contentsResponse.json();

    // 计算文件数量和总大小
    const fileStats = contentsData.reduce((acc, item) => {
      if (item.type === 'file') {
        return {
          count: acc.count + 1,
          size: acc.size + (item.size || 0)
        };
      }
      return acc;
    }, { count: 0, size: 0 });

    return {
      status: `working (${repoData.private ? 'private' : 'public'})`,
      fileCount: fileStats.count,
      fileSize: fileStats.size
    };

  } catch (error) {
    console.error(`Error checking GitHub repo ${repo}:`, error);
    return {
      status: `error: ${error.message}`,
      fileCount: 0,
      fileSize: 0
    };
  }
}

// 列出所有项目状态
async function listProjects(repos, githubUsername, githubRepoPrefix, githubPat, dir) {
  const actualUsername = await getGitHubUsername(githubPat);
  const statusChecks = repos.map(async repoNumber => {
    const repo = `${githubRepoPrefix}${repoNumber}`;
    const repoStatus = await checkGitHubRepo(githubUsername, repo, githubPat, dir);
    return `GitHub: ${repo} - ${repoStatus.status} (Username: ${actualUsername}, Files: ${repoStatus.fileCount}, Size: ${formatSize(repoStatus.fileSize)})`;
  });

  const results = await Promise.all(statusChecks);
  const result = results.join('\n');

  return new Response(result, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 检查状态请求
      if (url.pathname === `/${CONFIG.CHECK_PASSWORD || CONFIG.GITHUB_PAT}`) {
        return await listProjects(
          REPOS,
          CONFIG.GITHUB_USERNAME,
          CONFIG.GITHUB_REPO_PREFIX,
          CONFIG.GITHUB_PAT,
          CONFIG.DIR
        );
      }

      // 获取请求路径并解码，支持中文/日文/韩文等非 ASCII 文件名
      let requestPath;
      try {
        requestPath = decodeURIComponent(url.pathname);
      } catch (e) {
        requestPath = url.pathname;
      }
      const FILE = requestPath.split('/').pop();
      // 对路径各段重新编码，过滤空段避免双斜杠（如 DIR 为空时 main//文件名）
      const encodePathSegments = (path) =>
        path.split('/').filter(seg => seg !== '').map(seg => encodeURIComponent(seg)).join('/');

      // 缓存检查
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;
      let cacheResponse = await cache.match(cacheKey);

      if (cacheResponse) {
        return cacheResponse;
      }

      // 构建 GitHub raw 文件的 URL 列表，使用 encodePathSegments 支持中文/日文/韩文文件名，过滤空段避免双斜杠
      const urls = REPOS.map(repoNumber => {
        const parts = [CONFIG.DIR, FILE].filter(p => p && p !== '');
        const encodedPath = parts.map(p => encodePathSegments(p)).join('/');
        return `https://raw.githubusercontent.com/${CONFIG.GITHUB_USERNAME}/${CONFIG.GITHUB_REPO_PREFIX}${repoNumber}/main/${encodedPath}`;
      });

      // 创建并发请求
      const requests = urls.map(githubUrl => {
        return fetch(new Request(githubUrl, {
          method: 'GET',
          headers: {
            'Authorization': `token ${CONFIG.GITHUB_PAT}`,
            'Accept': 'application/vnd.github.v3.raw'
          }
        })).then(async response => {
          if (!response.ok) throw new Error(`Not Found in ${githubUrl}`);
          return response;
        });
      });

      // 等待第一个成功的请求
      const response = await Promise.any(requests);

      // 读取响应体
      const blob = await response.blob();

      // 创建新的响应，使用最小化的头部
      const result = new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
          'Cache-Control': `public, s-maxage=${CONFIG.CACHE_MAX_AGE}`,
          'Access-Control-Allow-Origin': '*'
        }
      });

      // 存储到缓存
      ctx.waitUntil(cache.put(cacheKey, result.clone()));

      return result;

    } catch (error) {
      // 错误响应使用最小化的头部
      return new Response(
        `404: Could not find ${url.pathname.split('/').pop()} in the image cluster.`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }
};