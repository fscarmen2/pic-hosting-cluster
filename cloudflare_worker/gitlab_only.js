// 用户配置区域开始 =================================

// 定义 GitLab 配置
const GITLAB_CONFIGS = [
    { name: 'repoName-1', id: 'repoID-1', token: 'repoAPI-1' },
    { name: 'repoName-2', id: 'repoID-2', token: 'repoAPI-2' },
    { name: 'repoName-3', id: 'repoID-3', token: 'repoAPI-3' },
    { name: 'repoName-4', id: 'repoID-4', token: 'repoAPI-4' },
];

// 用户设置的密码，用于状态检测功能，区分大小写。如果为空，则默认使用第一个仓库的 API 令牌作为密码
const CHECK_PASSWORD = '' || GITLAB_CONFIGS[0].token;

// 定义全局缓存时间，单位为秒，默认值为一年
const CACHE_MAX_AGE = 31556952;

// 用户配置区域结束 =================================

// 格式化文件大小，将字节转换为更易读的单位（GB/MB/kB）
function formatSize(sizeInBytes) {
  if (sizeInBytes >= 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(sizeInBytes / 1024).toFixed(2)} kB`;
  }
}

// 异步并发池，控制并发请求数量
async function asyncPool(concurrency, iterable, iteratorFn) {
  const ret = [];
  const executing = new Set();

  for (const item of iterable) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    // 如果正在执行的请求达到并发限制，等待某个请求完成
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

// 从 GitLab 获取单个文件大小，支持重试机制
async function getFileSizeFromGitLab(projectId, filePath, pat, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const fileUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/files${filePath}/raw?ref=main`;
      const response = await fetch(fileUrl, {
        method: 'HEAD',
        headers: { 'PRIVATE-TOKEN': pat }
      });

      if (response.status === 200) {
        const contentLength = response.headers.get('content-length');
        return contentLength ? parseInt(contentLength, 10) : 0;
      } else if (response.status === 429) {
        // 如果遇到请求限流，延迟重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      console.error(`Failed to get file size: ${response.status}`);
      return 0;
    } catch (error) {
      if (i === retries - 1) {
        console.error(`Error fetching file size:`, error);
      }
      if (i < retries - 1) {
        // 网络错误时延迟重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
    }
  }
  return 0;
}

// 检查 GitLab 项目状态和基本信息
async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
  const filesUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?ref=main&per_page=100&recursive=true`;

  try {
    const [projectResponse, filesResponse] = await Promise.all([
      fetch(projectUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      }),
      fetch(filesUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      })
    ]);

    if (projectResponse.status === 200) {
      const projectData = await projectResponse.json();
      let totalSize = 0;
      let fileCount = 0;

      if (filesResponse.status === 200) {
        const filesData = await filesResponse.json();
        fileCount = filesData.length;

        if (fileCount > 0) {
          // CONCURRENT_REQUESTS: 控制同时发起的并发请求数，防止对 GitLab API 施加过大压力
          const CONCURRENT_REQUESTS = 100; 
          const sizes = await asyncPool(CONCURRENT_REQUESTS, filesData, async (file) => {
            // 逐段编码路径，支持中文/日文/韩文文件名，同时保留多级目录的斜杠结构
            const encodedPath = '/' + file.path.split('/').map(seg => encodeURIComponent(seg)).join('/');
            const size = await getFileSizeFromGitLab(projectId, encodedPath, pat);
            return size;
          });

          totalSize = sizes.reduce((acc, size) => acc + size, 0);
        }
      }

      return [
        `working (${projectData.visibility})`,
        projectData.owner.username,
        fileCount,
        formatSize(totalSize)
      ];
    } else if (projectResponse.status === 404) {
      return ['not found', 'Unknown', 0, '0 B'];
    } else {
      return ['disconnect', 'Unknown', 0, '0 B'];
    }
  } catch (error) {
    console.error('GitLab project check error:', error);
    return ['disconnect', 'Error', 0, '0 B'];
  }
}

// 列出所有配置的 GitLab 项目状态
async function listProjects() {
  const projectChecks = GITLAB_CONFIGS.map(async (config) => {
    const [status, username, fileCount, totalSize] = await checkGitLabProject(config.id, config.token);
    return `GitLab: Project ID ${config.id} - ${status} (Username: ${username}, Files: ${fileCount}, Size: ${totalSize})`;
  });

  const results = await Promise.all(projectChecks);
  const result = results.join('\n');

  return new Response(result, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Cloudflare Worker 主处理逻辑
export default {
  async fetch(request, env, ctx) {
    try {
      // 创建缓存
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;

      // 检查缓存中是否已有响应
      let cacheResponse = await cache.match(cacheKey);
      if (cacheResponse) {
        return cacheResponse;
      }

      const url = new URL(request.url);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // 如果匹配检查密码，返回项目列表
      if (pathParts[0] === CHECK_PASSWORD) {
        return await listProjects();
      }

      // 验证 URL 格式
      if (pathParts.length < 1) {
        return new Response('Invalid URL format', {
          status: 400,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 查找对应的 GitLab 仓库配置
      const gitlabRepo = pathParts[0];
      const repoConfig = GITLAB_CONFIGS.find(repo => repo.name === gitlabRepo);

      if (!repoConfig) {
        return new Response('Repository not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 构建文件路径
      // 对路径各段逐段编码，支持中文/日文/韩文等非 ASCII 文件名，保留多级目录结构
      const filePath = pathParts.slice(1).map(seg => encodeURIComponent(seg)).join('/');
      console.log('Accessing file:', filePath);

      // 检查文件是否存在
      const checkUrl = `https://gitlab.com/api/v4/projects/${repoConfig.id}/repository/files/${encodeURIComponent(filePath)}?ref=main`;
      const checkResponse = await fetch(checkUrl, {
        headers: {
          'PRIVATE-TOKEN': repoConfig.token
        }
      });

      if (checkResponse.status === 404) {
        console.log('File not found:', filePath);
        return new Response('File not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 获取文件内容
      const apiUrl = `https://gitlab.com/api/v4/projects/${repoConfig.id}/repository/files/${encodeURIComponent(filePath)}/raw?ref=main`;
      const response = await fetch(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': repoConfig.token
        }
      });

      if (!response.ok) {
        console.error('GitLab API Error:', response.status);
        return new Response('Error fetching file', {
          status: response.status,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 创建响应并设置缓存
      const blob = await response.blob();
      const result = new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
          'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}`,
          'Access-Control-Allow-Origin': '*'
        }
      });

      // 异步缓存响应
      ctx.waitUntil(cache.put(cacheKey, result.clone()));
      return result;

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(`Internal Server Error: ${error.message}`, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
}