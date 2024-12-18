// 用户配置区域开始 =================================

// GitLab 节点配置
const GITLAB_CONFIGS = [
  { name: '', id: '', token: '' },  // GitLab 账户1
  { name: '', id: '', token: '' },  // GitLab 账户2
  { name: '', id: '', token: '' },  // GitLab 账户3
  { name: '', id: '', token: '' },  // GitLab 账户4
];

// GitHub 配置，仓库名与 GitLab 的相同，故创建仓库时需要注意一定要对称
const GITHUB_USERNAME = '';  // GitHub 用户名
const GITHUB_PAT = '';  // GitHub 个人访问令牌

// R2 存储配置，没有可以留空不填，但不要删除
const R2_CONFIGS = [
  {
    name: '',  // 帐户1 ID
    accountId: '',  // 帐户1 访问密钥 ID
    accessKeyId: '',  // 帐户1 机密访问密钥
    secretAccessKey: '',  // 帐户1 机密访问密钥
    bucket: '' // 帐户1 R2 存储桶名称
  },
  {
    name: '',  // 帐户2 ID
    accountId: '',  // 帐户2 访问密钥 ID
    accessKeyId: '',  // 帐户2 机密访问密钥
    secretAccessKey: '',  // 帐户2 机密访问密钥
    bucket: '' // 帐户2 R2 存储桶名称
  },
  // 可以添加更多 R2 配置
];

// B2 存储配置，没有可以留空不填，但不要删除
const B2_CONFIGS = [
  {
    name: '',  // 帐户1 名
    endPoint: '',  // 账户1 Endpoint
    keyId: '',  // 账户1 keyID
    applicationKey: '',  // 账户1 applicationKey
    bucket: ''  // 账户1桶名 bucketName
  },
  {
    name: '',  // 帐户2 名
    endPoint: '',  // 账户2 Endpoint
    keyId: '',  // 账户2 keyID
    applicationKey: '',  // 账户2 applicationKey
    bucket: ''  // 账户2桶名 bucketName
  },
  // 可以添加更多 B2 配置
];

// 定义集群访问目录
let DIR = '';

// 定义集群里全部节点连接状态的密码验证，区分大小写（优先使用自定义密码，若为空则使用 GITHUB_PAT）
const CHECK_PASSWORD = '' || GITHUB_PAT;

// GitHub 备份策略
const STRATEGY = 'size'  // 可选 [size (默认) | quantity | 指定节点]; size: 选择容量最少的仓库来存储文件; quantity: 选择文件最少的仓库来存储文件; 指定节点: 比如  pic1 或者 pic2
const DELETE = 'true'  // 可选 [true (默认) | false]，已复制到 GitHub 的文件，是否从 R2 删除

// 用户配置区域结束 =================================

// 检查配置是否有效
function hasValidConfig() {
  // 检查 GitHub 配置
  const hasGithub = GITHUB_PAT && GITHUB_USERNAME && GITLAB_CONFIGS && 
                    GITLAB_CONFIGS.length > 0 && 
                    GITLAB_CONFIGS.some(config => config.name && config.id && config.token);

  // 检查 GitLab 配置
  const hasGitlab = GITLAB_CONFIGS && 
                    GITLAB_CONFIGS.length > 0 && 
                    GITLAB_CONFIGS.some(config => config.name && config.id && config.token);

  // 检查 R2 配置
  const hasR2 = R2_CONFIGS && 
                R2_CONFIGS.length > 0 && 
                R2_CONFIGS.some(config => 
                  config.name && 
                  config.accountId && 
                  config.accessKeyId && 
                  config.secretAccessKey && 
                  config.bucket
                );

  // 检查 B2 配置
  const hasB2 = B2_CONFIGS && 
                B2_CONFIGS.length > 0 && 
                B2_CONFIGS.some(config => 
                  config.name && 
                  config.endPoint && 
                  config.keyId && 
                  config.applicationKey && 
                  config.bucket
                );

  return {
    github: hasGithub,
    gitlab: hasGitlab,
    r2: hasR2,
    b2: hasB2
  };
}

// AWS SDK 签名相关函数开始 =================================

// 获取签名URL
async function getSignedUrl(config, method, path) {
  const region = 'auto';
  const service = 's3';

  // 根据配置类型确定 host 和认证信息
  const host = config.endPoint
    ? config.endPoint  // B2 配置使用 endPoint
    : `${config.accountId}.r2.cloudflarestorage.com`;  // R2 配置使用默认格式

  // 根据配置类型确定认证信息
  const accessKeyId = config.endPoint ? config.keyId : config.accessKeyId;
  const secretKey = config.endPoint ? config.applicationKey : config.secretAccessKey;

  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.substr(0, 8);

  const canonicalRequest = [
    method,
    '/' + path,
    '',
    `host:${host}`,
    'x-amz-content-sha256:UNSIGNED-PAYLOAD',
    `x-amz-date:${datetime}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    `${date}/${region}/${service}/aws4_request`,
    await sha256(canonicalRequest)
  ].join('\n');

  const signature = await getSignature(
    secretKey,
    date,
    region,
    service,
    stringToSign
  );

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${date}/${region}/${service}/aws4_request`,
    `SignedHeaders=host;x-amz-content-sha256;x-amz-date`,
    `Signature=${signature}`
  ].join(', ');

  return {
    url: `https://${host}/${path}`,
    headers: {
      'Authorization': authorization,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': datetime,
      'Host': host
    }
  };
}

// SHA256 哈希函数
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// HMAC-SHA256 函数
async function hmacSha256(key, message) {
  const keyBuffer = key instanceof ArrayBuffer ? key : new TextEncoder().encode(key);
  const messageBuffer = new TextEncoder().encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageBuffer
  );

  return signature;
}

// 获取签名
async function getSignature(secret, date, region, service, stringToSign) {
  const kDate = await hmacSha256('AWS4' + secret, date);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256(kSigning, stringToSign);

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// AWS SDK 签名相关函数结束 =================================

// 检查服务函数
async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user';
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    });

    if (response.status === 200) {
      const data = await response.json();
      return data.login;
    } else {
      console.error('GitHub API Error:', response.status);
      return 'Unknown';
    }
  } catch (error) {
    console.error('GitHub request error:', error);
    return 'Error';
  }
}

// 检查 GitHub 仓库
async function checkGitHubRepo(owner, repo, pat) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${finalPath}`;

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

    if (contentsResponse.status !== 200) {
      return [`working (${repoData.private ? 'private' : 'public'})`, 0, 0];
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

    return [
      `working (${repoData.private ? 'private' : 'public'})`,
      fileStats.count,
      fileStats.size
    ];

  } catch (error) {
    console.error(`Error checking GitHub repo ${repo}:`, error);
    return [`error: ${error.message}`, 0, 0];
  }
}

// 检查 GitLab 项目
async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
  const filesUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?ref=main&path=${finalPath}&recursive=true&per_page=10000`;

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
      let fileCount = 0;

      if (filesResponse.status === 200) {
        const filesData = await filesResponse.json();
        fileCount = filesData.filter(item => item.type === 'blob').length;
      }

      return [
        `working (${projectData.visibility})`,
        projectData.owner.username,
        fileCount
      ];
    } else if (projectResponse.status === 404) {
      return ['not found', 'Unknown', 0];
    } else {
      return ['disconnect', 'Unknown', 0];
    }
  } catch (error) {
    console.error('GitLab project check error:', error);
    return ['disconnect', 'Error', 0];
  }
}

// 检查 R2 存储
async function checkR2Storage(r2Config) {
  try {
    const listPath = `${r2Config.bucket}`;
    const signedRequest = await getSignedUrl(r2Config, 'GET', listPath);

    const response = await fetch(signedRequest.url, {
      headers: signedRequest.headers
    });

    let fileCount = 0;
    let totalSize = 0;

    if (response.ok) {
      const data = await response.text();
      const keys = data.match(/<Key>([^<]+)<\/Key>/g) || [];
      const sizes = data.match(/<Size>(\d+)<\/Size>/g) || [];

      keys.forEach((key, index) => {
        const filePath = key.replace(/<Key>|<\/Key>/g, '');
        if (filePath.startsWith(DIR + '/')) {
          fileCount++;
          const size = parseInt(sizes[index]?.replace(/<Size>|<\/Size>/g, '') || String(0), 10);
          totalSize += size;
        }
      });
    }

    const status = response.ok ? 'working' : 'error';

    return [
      status,
      r2Config.name,
      r2Config.bucket,
      fileCount,
      formatSize(totalSize)
    ];
  } catch (error) {
    console.error('R2 Storage error:', error);
    return ['error', r2Config.name, 'connection failed', 0, '0 B'];
  }
}

// 检查 B2 存储
async function checkB2Storage(b2Config) {
  try {
    const listPath = `${b2Config.bucket}`;
    const signedRequest = await getSignedUrl(b2Config, 'GET', listPath);

    const response = await fetch(signedRequest.url, {
      headers: signedRequest.headers
    });

    let fileCount = 0;
    let totalSize = 0;

    if (response.ok) {
      const data = await response.text();
      const keys = data.match(/<Key>([^<]+)<\/Key>/g) || [];
      const sizes = data.match(/<Size>(\d+)<\/Size>/g) || [];

      keys.forEach((key, index) => {
        const filePath = key.replace(/<Key>|<\/Key>/g, '');
        if (filePath.startsWith(DIR + '/')) {
          fileCount++;
          const size = parseInt(sizes[index]?.replace(/<Size>|<\/Size>/g, '') || String(0), 10);
          totalSize += size;
        }
      });
    }

    const status = (response.status === 404 || response.status === 403 || response.ok) ? 'working' : 'error';

    return [
      status,
      b2Config.name,
      b2Config.bucket,
      fileCount,
      formatSize(totalSize)
    ];
  } catch (error) {
    console.error('B2 Storage error:', error);
    return ['error', b2Config.name, 'connection failed', 0, '0 B'];
  }
}

// 文件大小格式化函数
function formatSize(sizeInBytes) {
  if (sizeInBytes >= 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(sizeInBytes / 1024).toFixed(2)} kB`;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const from = url.searchParams.get('from')?.toLowerCase();
    const validConfigs = hasValidConfig();

    // 直接使用 GITLAB_CONFIGS 中的 name 作为 GitHub 仓库名
    const githubRepos = GITLAB_CONFIGS.map(config => config.name);
    const FILE = url.pathname.split('/').pop();
    //确认最终路径
	  let finalPath="";
	  // 如果斜杠开头 去除斜杠
	  if(FILEPATH.startsWith('/')){
		    FILEPATH=FILEPATH.substring(1);
	  }
	  // dir参数 是否是filepath 的开头 如果是则不拼接dir 否则拼接dir到filepath
	  // 检查 FILEPATH 是否以 `/${DIR}` 开头
	
	  if (FILEPATH.startsWith(DIR)) {
		    // 如果 FILEPATH 已经包含 DIR，则直接使用 FILEPATH
		    finalPath = FILEPATH;
	  } else {
		  // 如果 FILEPATH 是绝对路径，拼接时去掉可能的多余斜杠
		  finalPath = `${DIR}${FILEPATH.startsWith("/") ? "" : "/"}${FILEPATH}`;
	  }
    // 只在没有 from 参数时才检查和使用缓存
    let cacheResponse;
    if (!from) {
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;
      cacheResponse = await cache.match(cacheKey);

      if (cacheResponse) {
        return cacheResponse;
      }
    }

    // 检查状态页面
    if (url.pathname === `/${CHECK_PASSWORD}`) {
      let result = '';
      let hasAnyValidConfig = false;

      try {
        // GitHub 状态检查
        if (validConfigs.github) {
          hasAnyValidConfig = true;
          result += '=== GitHub Status ===\n';
          const username = await getGitHubUsername(GITHUB_PAT);
          for (const repo of githubRepos) {
            const [status, fileCount, totalSize] = await checkGitHubRepo(GITHUB_USERNAME, repo, GITHUB_PAT);
            const formattedSize = formatSize(totalSize);
            result += `GitHub: ${repo} - ${status} (Username: ${username}, Files: ${fileCount}, Size: ${formattedSize})\n`;
          }
        }

        // GitLab 状态检查
        if (validConfigs.gitlab) {
          hasAnyValidConfig = true;
          result += result ? '\n=== GitLab Status ===\n' : '=== GitLab Status ===\n';
          for (const config of GITLAB_CONFIGS) {
            const [status, username, fileCount] = await checkGitLabProject(config.id, config.token);
            result += `GitLab: Project ID ${config.id} - ${status} (Username: ${username}, Files: ${fileCount})\n`;
          }
        }

        // R2 状态检查
        if (validConfigs.r2) {
          hasAnyValidConfig = true;
          result += result ? '\n=== R2 Storage Status ===\n' : '=== R2 Storage Status ===\n';
          for (const config of R2_CONFIGS) {
            const [status, name, bucket, fileCount, totalSize] = await checkR2Storage(config);
            result += `R2 Storage: ${name} - ${status} (Bucket: ${bucket}, Files: ${fileCount}, Size: ${totalSize})\n`;
          }
        }

        // B2 状态检查
        if (validConfigs.b2) {
          hasAnyValidConfig = true;
          result += result ? '\n=== B2 Storage Status ===\n' : '=== B2 Storage Status ===\n';
          for (const config of B2_CONFIGS) {
            const [status, name, bucket, fileCount, totalSize] = await checkB2Storage(config);
            result += `B2 Storage: ${name} - ${status} (Bucket: ${bucket}, Files: ${fileCount}, Size: ${totalSize})\n`;
          }
        }

        // 如果没有任何有效配置
        if (!hasAnyValidConfig) {
          result = 'No storage services configured.\n';
        } else {
          result = 'Storage status:\n\n' + result;
        }

      } catch (error) {
        result += `Error during status check: ${error.message}\n`;
      }

      return new Response(result, {
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const startTime = Date.now();
    let requests = [];

    // 检查特定服务的请求是否有效
    if (from) {
      if (from === 'github' && !validConfigs.github) {
        return new Response('GitHub service is not configured.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (from === 'gitlab' && !validConfigs.gitlab) {
        return new Response('GitLab service is not configured.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (from === 'r2' && !validConfigs.r2) {
        return new Response('R2 storage service is not configured.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (from === 'b2' && !validConfigs.b2) {
        return new Response('B2 storage service is not configured.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 生成存储请求
    const generateStorageRequests = async () => {
      let requests = [];

      if (validConfigs.r2) {
        const r2Requests = await Promise.all(R2_CONFIGS.map(async (r2Config) => {
          const r2Path = `${r2Config.bucket}/${finalPath}`;
          const signedRequest = await getSignedUrl(r2Config, 'GET', r2Path);
          return {
            url: signedRequest.url,
            headers: signedRequest.headers,
            source: 'r2',
            repo: `${r2Config.name} (${r2Config.bucket})`
          };
        }));
        requests = [...requests, ...r2Requests];
      }

      if (validConfigs.b2) {
        const b2Requests = await Promise.all(B2_CONFIGS.map(async (b2Config) => {
          const b2Path = `${b2Config.bucket}/${finalPath}`;
          const signedRequest = await getSignedUrl(b2Config, 'GET', b2Path);
          return {
            url: signedRequest.url,
            headers: signedRequest.headers,
            source: 'b2',
            repo: `${b2Config.name} (${b2Config.bucket})`
          };
        }));
        requests = [...requests, ...b2Requests];
      }

      return requests;
    };

    // 处理不同类型的请求
    if (from === 'where') {
      if (validConfigs.github) {
        const githubRequests = githubRepos.map(repo => ({
          url: `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${finalPath}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo,
          processResponse: async (response) => {
            if (!response.ok) throw new Error('Not found');
            const data = await response.json();
            return {
              size: data.size,
              exists: true
            };
          }
        }));
        requests = [...requests, ...githubRequests];
      }

      if (validConfigs.gitlab) {
        const gitlabRequests = GITLAB_CONFIGS.map(config => ({
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${finalPath}`)}?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name,
          processResponse: async (response) => {
            if (!response.ok) throw new Error('Not found');
            const data = await response.json();
            const size = atob(data.content).length;
            return {
              size: size,
              exists: true
            };
          }
        }));
        requests = [...requests, ...gitlabRequests];
      }

      const storageRequests = await generateStorageRequests();
      const storageWhereRequests = storageRequests.map(request => ({
        ...request,
        processResponse: async (response) => {
          if (!response.ok) throw new Error('Not found');
          const size = response.headers.get('content-length');
          return {
            size: parseInt(size),
            exists: true
          };
        }
      }));
      requests = [...requests, ...storageWhereRequests];

    } else {
      // 获取文件内容模式
      if (from === 'github' && validConfigs.github) {
        requests = githubRepos.map(repo => ({
          url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${finalPath}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo
        }));
      } else if (from === 'gitlab' && validConfigs.gitlab) {
        requests = GITLAB_CONFIGS.map(config => ({
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${finalPath}`)}/raw?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name
        }));
      } else if ((from === 'r2' && validConfigs.r2) || (from === 'b2' && validConfigs.b2)) {
        requests = await generateStorageRequests();
        requests = requests.filter(req => req.source === from);
      } else if (!from) {
        if (validConfigs.github) {
          const githubRequests = githubRepos.map(repo => ({
            url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${finalPath}`,
            headers: {
              'Authorization': `token ${GITHUB_PAT}`,
              'User-Agent': 'Cloudflare Worker'
            },
            source: 'github',
            repo: repo
          }));
          requests = [...requests, ...githubRequests];
        }

        if (validConfigs.gitlab) {
          const gitlabRequests = GITLAB_CONFIGS.map(config => ({
            url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${finalPath}`)}/raw?ref=main`,
            headers: {
              'PRIVATE-TOKEN': config.token
            },
            source: 'gitlab',
            repo: config.name
          }));
          requests = [...requests, ...gitlabRequests];
        }

        const storageRequests = await generateStorageRequests();
        requests = [...requests, ...storageRequests];
      }
    }

    // 处理请求和响应
    try {
      if (requests.length === 0) {
        throw new Error('No valid source specified or no valid configurations found');
      }

      const fetchPromises = requests.map(request => {
        const { url, headers, source, repo, processResponse } = request;

        return fetch(new Request(url, {
          method: 'GET',
          headers: headers
        })).then(async response => {
          if (from === 'where' && typeof processResponse === 'function') {
            try {
              const result = await processResponse(response);
              const endTime = Date.now();
              const duration = endTime - startTime;

              const formattedSize = result.size > 1024 * 1024
                ? `${(result.size / (1024 * 1024)).toFixed(2)} MB`
                : `${(result.size / 1024).toFixed(2)} kB`;

              return {
                fileName: FILE,
                size: formattedSize,
                source: `${source} (${repo})`,
                duration: `${duration}ms`
              };
            } catch (error) {
              throw new Error(`Not found in ${source} (${repo})`);
            }
          } else {
            if (!response.ok) {
              throw new Error(`Not found in ${source} (${repo})`);
            }
            return response;
          }
        }).catch(error => {
          throw new Error(`Error in ${source} (${repo}): ${error.message}`);
        });
      });

      const result = await Promise.any(fetchPromises);

      let response;
      if (from === 'where') {
        response = new Response(JSON.stringify(result, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else if (result instanceof Response) {
        const blob = await result.blob();
        const headers = {
          'Content-Type': result.headers.get('Content-Type') || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        };

        if (from) {
          headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
          headers['Pragma'] = 'no-cache';
          headers['Expires'] = '0';
        }

        response = new Response(blob, {
          status: 200,
          headers: headers
        });
      } else {
        throw new Error("Unexpected result type");
      }

      if (!from && from !== 'where') {
        const cacheUrl = new URL(request.url);
        const cacheKey = new Request(cacheUrl.toString(), request);
        const cache = caches.default;
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;

    } catch (error) {
      const sourceText = from === 'where'
        ? 'in any repository'
        : from
          ? `from ${from}`
          : 'in any configured storage';

      const errorResponse = new Response(
        `404: Cannot find ${FILE} ${sourceText}. ${error.message}`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );

      return errorResponse;
    }
  }
}
