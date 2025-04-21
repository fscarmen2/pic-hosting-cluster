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
const DIR = '';

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
async function getSignedUrl(config, method, path, queryParams = {}) {
  const region = config.endPoint ? config.endPoint.split('.')[1] : 'auto';
  const service = 's3';
  const host = config.endPoint || `${config.accountId}.r2.cloudflarestorage.com`;
  const accessKeyId = config.endPoint ? config.keyId : config.accessKeyId;
  const secretKey = config.endPoint ? config.applicationKey : config.secretAccessKey;
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.substr(0, 8);

  // 确保路径正确编码，但保留斜杠
  const encodedPath = path.split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  // 构建规范请求
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${datetime}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  // 按字母顺序排序查询参数
  const sortedParams = Object.keys(queryParams).sort().reduce((acc, key) => {
    acc[key] = queryParams[key];
    return acc;
  }, {});

  const canonicalQueryString = Object.entries(sortedParams)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const canonicalRequest = [
    method,
    '/' + encodedPath,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
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
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(', ');

  const url = `https://${host}/${encodedPath}${canonicalQueryString ? '?' + canonicalQueryString : ''}`;

  return {
    url,
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

// 修改文件路径处理函数
function getFilePath(basePath, requestPath) {
  // 移除开头的斜杠
  const cleanRequestPath = requestPath.replace(/^\//, '');

  // 如果没有设置 basePath，直接返回请求路径
  if (!basePath) return cleanRequestPath;

  // 组合基础路径和请求路径
  return `${basePath}/${cleanRequestPath}`;
}

// 检查 GitHub 仓库
async function checkGitHubRepo(owner, repo, pat) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const headers = {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare Worker'
  };

  try {
    // 获取仓库信息，确定默认分支
    const repoResponse = await fetch(repoUrl, { headers });
    const repoData = await repoResponse.json();

    if (repoResponse.status!== 200) {
      throw new Error(`Repository error: ${repoData.message}`);
    }

    const defaultBranch = repoData.default_branch;
    const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;

    // 获取文件树信息
    const contentsResponse = await fetch(contentsUrl, { headers });
    if (contentsResponse.status!== 200) {
      const contentsErrorData = await contentsResponse.json();
      throw new Error(`Contents error: ${contentsErrorData.message}`);
    }

    const contentsData = await contentsResponse.json();

    let fileCount = 0;
    let totalSize = 0;

    if (contentsData.tree) {
      for (const item of contentsData.tree) {
        // 检查是否是文件
        if (item.type === 'blob' && (DIR === '' || item.path.startsWith(DIR + '/'))) {
          fileCount++;
          totalSize += item.size || 0;
        }
      }
    }

    return [
      `working (${repoData.private ? 'private' : 'public'})`,
      fileCount,
      totalSize
    ];

  } catch (error) {
    console.error(`Error checking GitHub repo ${repo}:`, error);
    return [`error: ${error.message}`, 0, 0];
  }
}

// 检查 GitLab 项目
async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
  const treeUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?recursive=true&per_page=100&path=${DIR}`;

  try {
    const [projectResponse, treeResponse] = await Promise.all([
      fetch(projectUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      }),
      fetch(treeUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      })
    ]);

    if (projectResponse.status === 200) {
      const projectData = await projectResponse.json();
      let fileCount = 0;

      if (treeResponse.status === 200) {
        const treeData = await treeResponse.json();
        // 只计算文件，不计算目录
        fileCount = treeData.filter(item => item.type === 'blob').length;
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
    // 列出所有文件
    const listRequest = await getSignedUrl(r2Config, 'GET', r2Config.bucket, {
      'list-type': '2',
      'prefix': DIR ? `${DIR}/` : ''  // 添加目录前缀筛选
    });

    const response = await fetch(listRequest.url, {
      headers: {
        ...listRequest.headers,
        'Host': `${r2Config.accountId}.r2.cloudflarestorage.com`
      }
    });

    let fileCount = 0;
    let totalSize = 0;

    if (response.ok) {
      const data = await response.text();

      // 使用正则表达式匹配所有文件信息
      const contents = data.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];

      for (const content of contents) {
        const keyMatch = content.match(/<Key>([^<]+)<\/Key>/);
        const sizeMatch = content.match(/<Size>(\d+)<\/Size>/);

        if (keyMatch && sizeMatch) {
          const key = keyMatch[1];
          // 只计算文件，不计算目录
          if (!key.endsWith('/')) {
            fileCount++;
            totalSize += parseInt(sizeMatch[1]);
          }
        }
      }
    }

    return [
      'working',
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
    // 构建列出文件的请求，移除 delimiter 参数以获取所有子目录
    const signedRequest = await getSignedUrl(b2Config, 'GET', b2Config.bucket, {
      'prefix': DIR ? `${DIR}/` : ''
    });

    const response = await fetch(signedRequest.url, {
      headers: {
        ...signedRequest.headers,
        'Host': b2Config.endPoint
      }
    });

    let fileCount = 0;
    let totalSize = 0;

    if (response.ok) {
      const data = await response.text();
      // 使用正则表达式匹配所有文件信息
      const keyRegex = /<Key>([^<]+)<\/Key>/g;
      const sizeRegex = /<Size>(\d+)<\/Size>/g;

      let keyMatch;
      while ((keyMatch = keyRegex.exec(data)) !== null) {
        const key = keyMatch[1];
        // 只计算文件，不计算目录，并确保文件在指定目录下
        if (!key.endsWith('/') && (!DIR || key.startsWith(DIR + '/'))) {
          fileCount++;
          // 获取对应的文件大小
          const sizeMatch = /<Size>(\d+)<\/Size>/g.exec(data.slice(keyMatch.index));
          if (sizeMatch) {
            totalSize += parseInt(sizeMatch[1]);
          }
        }
      }

      return [
        'working',
        b2Config.name,
        b2Config.bucket,
        fileCount,
        formatSize(totalSize)
      ];
    } else {
      throw new Error(`Failed to list bucket: ${response.status} ${response.statusText}`);
    }

  } catch (error) {
    console.error('B2 Storage error:', error);
    return ['error', b2Config.name, b2Config.bucket, 0, '0 B'];
  }
}

// 删除 GitHub 仓库中的文件
async function deleteGitHubFile(repo, filePath, pat) {
  // 构建完整的文件路径，包含 DIR
  const fullPath = DIR ? `${DIR}/${filePath.replace(/^\/+/, '')}` : filePath.replace(/^\/+/, '');
  const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${fullPath}`;

  try {
    // 先检查文件是否存在
    const getResponse = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    });

    if (getResponse.status === 404) {
      return '文件不存在';
    }

    if (!getResponse.ok) {
      const errorData = await getResponse.json();
      return `删除失败：(${errorData.message})`;
    }

    const fileData = await getResponse.json();

    // 执行删除操作
    const deleteResponse = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      },
      body: JSON.stringify({
        message: `Delete ${fullPath}`,
        sha: fileData.sha
      })
    });

    if (deleteResponse.ok) {
      return '删除成功';
    } else {
      const errorData = await deleteResponse.json();
      return `删除失败：(${errorData.message})`;
    }
  } catch (error) {
    console.error('GitHub delete error:', error);
    return `删除失败：(${error.message})`;
  }
}

// 删除 GitLab 项目中的文件
async function deleteGitLabFile(projectId, filePath, pat) {
  // 构建完整的文件路径，包含 DIR
  const fullPath = DIR ? `${DIR}/${filePath.replace(/^\/+/, '')}` : filePath.replace(/^\/+/, '');
  const encodedPath = encodeURIComponent(fullPath);
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodedPath}`;

  try {
    // 执行删除操作
    const deleteResponse = await fetch(url, {
      method: 'DELETE',
      headers: {
        'PRIVATE-TOKEN': pat,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        branch: 'main',
        commit_message: 'Delete file: ' + fullPath
      })
    });

    // 获取响应数据
    const errorData = await deleteResponse.json().catch(() => ({}));

    // 处理文件不存在的所有可能情况
    if (deleteResponse.status === 404 ||
      errorData.message === 'A file with this name doesn\'t exist' ||
      errorData.message?.includes('file does not exist') ||
      errorData.message?.includes('File not found')) {
      return '文件不存在';
    }

    // 处理删除成功的情况
    if (deleteResponse.ok ||
      errorData.message?.includes('reference update') ||
      errorData.message?.includes('reference does not point')) {
      return '删除成功';
    }

    return `删除失败：(${errorData.message || '未知错误'})`;
  } catch (error) {
    console.error('GitLab delete error:', error);
    if (error.message?.includes('file') && error.message?.includes('exist')) {
      return '文件不存在';
    }
    return `删除失败：(${error.message})`;
  }
}

// 删除 R2 存储中的文件
async function deleteR2File(r2Config, filePath) {
  // 构建完整的文件路径，包含 DIR
  const fullPath = DIR ? `${DIR}/${filePath.replace(/^\/+/, '')}` : filePath.replace(/^\/+/, '');

  try {
    // 1. 首先列出所有文件
    const listRequest = await getSignedUrl(r2Config, 'GET', r2Config.bucket, {
      'list-type': '2',
      'prefix': fullPath  // 使用精确的前缀匹配
    });

    const listResponse = await fetch(listRequest.url, {
      headers: {
        ...listRequest.headers,
        'Host': `${r2Config.accountId}.r2.cloudflarestorage.com`
      }
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to list objects: ${listResponse.statusText}`);
    }

    // 解析响应
    const listData = await listResponse.text();
    const contents = listData.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    let fileExists = false;

    // 精确匹配文件路径
    for (const content of contents) {
      const keyMatch = content.match(/<Key>([^<]+)<\/Key>/);
      if (keyMatch && keyMatch[1] === fullPath) {
        fileExists = true;
        break;
      }
    }

    if (!fileExists) {
      return '文件不存在';
    }

    // 2. 删除文件
    const deleteRequest = await getSignedUrl(r2Config, 'DELETE', `${r2Config.bucket}/${fullPath}`);

    const deleteResponse = await fetch(deleteRequest.url, {
      method: 'DELETE',
      headers: {
        ...deleteRequest.headers,
        'Host': `${r2Config.accountId}.r2.cloudflarestorage.com`
      }
    });

    if (!deleteResponse.ok) {
      const deleteResponseText = await deleteResponse.text();
      throw new Error(`Failed to delete: ${deleteResponse.status} - ${deleteResponseText}`);
    }

    return '删除成功';
  } catch (error) {
    console.error('R2 delete error:', error);
    return `删除失败：(${error.message})`;
  }
}

// 删除 B2 存储中的文件
async function deleteB2File(b2Config, filePath) {
  // 构建完整的文件路径，包含 DIR
  const fullPath = DIR ? `${DIR}/${filePath.replace(/^\/+/, '')}` : filePath.replace(/^\/+/, '');

  try {
    // 1. 首先列出所有文件
    const listObjectsRequest = await getSignedUrl(b2Config, 'GET', b2Config.bucket, {
      'list-type': '2',
      'prefix': fullPath
    });

    const listResponse = await fetch(listObjectsRequest.url, {
      headers: {
        ...listObjectsRequest.headers,
        'Host': b2Config.endPoint
      }
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to list objects: ${listResponse.statusText}`);
    }

    // 解析 XML 响应
    const listData = await listResponse.text();
    const keyRegex = /<Key>([^<]+)<\/Key>/g;
    const fileExists = Array.from(listData.matchAll(keyRegex))
      .some(match => match[1] === fullPath);

    if (!fileExists) {
      return '文件不存在';
    }

    // 2. 获取文件的版本信息
    const versionsRequest = await getSignedUrl(b2Config, 'GET', b2Config.bucket, {
      'versions': '',
      'prefix': fullPath,
      'list-type': '2'
    });

    const versionsResponse = await fetch(versionsRequest.url, {
      headers: {
        ...versionsRequest.headers,
        'Host': b2Config.endPoint,
        'x-amz-date': versionsRequest.headers['x-amz-date'],
        'Authorization': versionsRequest.headers['Authorization']
      }
    });

    if (!versionsResponse.ok) {
      const responseText = await versionsResponse.text();
      console.error('Version listing response:', responseText);
      throw new Error(`Failed to list versions: ${versionsResponse.status} - ${responseText}`);
    }

    const versionsData = await versionsResponse.text();

    // 解析版本信息
    const versionMatch = versionsData.match(/<Version>[\s\S]*?<VersionId>([^<]+)<\/VersionId>[\s\S]*?<\/Version>/);
    if (!versionMatch) {
      throw new Error('No version information found');
    }

    const versionId = versionMatch[1];

    // 3. 删除指定版本的文件
    const deleteRequest = await getSignedUrl(b2Config, 'DELETE', `${b2Config.bucket}/${fullPath}`, {
      'versionId': versionId
    });

    const deleteResponse = await fetch(deleteRequest.url, {
      method: 'DELETE',
      headers: {
        ...deleteRequest.headers,
        'Host': b2Config.endPoint,
        'x-amz-date': deleteRequest.headers['x-amz-date'],
        'Authorization': deleteRequest.headers['Authorization']
      }
    });

    if (!deleteResponse.ok) {
      const deleteResponseText = await deleteResponse.text();
      throw new Error(`Failed to delete: ${deleteResponse.status} - ${deleteResponseText}`);
    }

    return '删除成功';
  } catch (error) {
    console.error('B2 delete error:', error);
    return `删除失败：(${error.message})`;
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
    // 获取请求 URL 对象
    const url = new URL(request.url);

    // 从 URL 的查询参数中获取 'from' 参数并转换为小写
    const from = url.searchParams.get('from')?.toLowerCase();

    // 检查是否有有效的配置，调用 `hasValidConfig()` 函数
    const validConfigs = hasValidConfig();

    // 获取请求路径并解码（对 URL 编码进行解码）
    const requestPath = decodeURIComponent(url.pathname);

    // 添加根路径项目介绍
    if (requestPath === '/') {
      return new Response(
        '欢迎来到文件托管集群！(File Hosting Cluster)\n' +
        '这是一个分布式存储集群项目，旨在提供高效的文件存储和管理服务。\n\n' +
        '项目链接： https://github.com/fscarmen2/pic-hosting-cluster\n' +
        '视频介绍： https://youtu.be/5i-86oBLWP8\n\n' +
        '您可以使用以下操作：\n' +
        '1. 从集群所有节点获取文件： /<文件名>\n' +
        '2. 指定从 Github 获取文件： /<文件名>?from=github\n' +
        '3. 指定从 Gitlab 获取文件： /<文件名>?from=gitlab\n' +
        '4. 指定从 Cloudflare R2 获取文件： /<文件名>?from=r2\n' +
        '5. 指定从 Backblaze B2 获取文件： /<文件名>?from=b2\n' +
        '6. 查找文件信息： /<文件名>?from=where\n' +
        '7. 查各节点状态： /<自定义密码>\n' +
        '8. 删除文件： /<自定义密码>/del?file=<文件名>',
        {
          headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // 从路径中提取文件名（即路径的最后一部分）
    const FILE = requestPath.split('/').pop();

    // 获取子目录路径，移除开头和结尾的斜杠
    const subPath = requestPath.substring(1, requestPath.lastIndexOf('/')).replace(/^\/+|\/+$/g, '');

    // 如果 DIR 存在，拼接 DIR 和子目录路径；否则仅使用子目录路径
    const fullPath = DIR ? `${DIR}/${subPath}` : subPath;

    // 检查请求路径是否匹配删除请求（支持 'delete' 或 'del'）
    const isDeleteRequest = requestPath.match(new RegExp(`^/${CHECK_PASSWORD}/(delete|del)$`));

    // 检查是否是未授权的删除请求
    const isUnauthorizedDelete = requestPath.match(/^\/(delete|del)$/);
    if (isUnauthorizedDelete) {
      const file = url.searchParams.get('file');
      if (!file) {
        return new Response(
          '需要指定要删除的文件。\n' +
          '正确的删除格式为: /<自定义密码>/del?file=文件路径\n' +
          '例如: /<自定义密码>/del?file=example.png',
          {
            status: 403,
            headers: {
              'Content-Type': 'text/plain; charset=UTF-8',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }

      return new Response(
        '需要密码验证才能删除文件。\n' +
        '要删除文件 ' + file + ' 的正确格式为:\n' +
        '/<自定义密码>/del?file=' + file,
        {
          status: 403,
          headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // 从 GITLAB_CONFIGS 中获取每个配置的 name 作为 GitHub 仓库名
    const githubRepos = GITLAB_CONFIGS.map(config => config.name);

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
          'Content-Type': 'text/plain; charset=UTF-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 添加删除路由
    if (isDeleteRequest) {
      const file = url.searchParams.get('file');
      if (!file) {
        return new Response('Missing "file" parameter', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
        });
      }

      let result = `Delete：${file}\n`;

      // GitHub 状态
      if (validConfigs.github) {
        result += '\n=== GitHub Status ===\n';
        const githubRepos = GITLAB_CONFIGS.map(config => config.name);
        for (const repo of githubRepos) {
          const status = await deleteGitHubFile(repo, file, GITHUB_PAT);
          result += `GitHub: ${repo} - working (private) ${status}\n`;
        }
      }

      // GitLab 状态
      if (validConfigs.gitlab) {
        result += '\n=== GitLab Status ===\n';
        for (const config of GITLAB_CONFIGS) {
          const status = await deleteGitLabFile(config.id, file, config.token);
          const projectData = await fetch(`https://gitlab.com/api/v4/projects/${config.id}`, {
            headers: { 'PRIVATE-TOKEN': config.token }
          }).then(res => res.json());
          result += `GitLab: Project ID ${config.id} - working (${projectData.visibility}) ${status}\n`;
        }
      }

      // R2 存储状态
      if (validConfigs.r2) {
        result += '\n=== R2 Storage Status ===\n';
        for (const config of R2_CONFIGS) {
          const status = await deleteR2File(config, file);
          result += `R2 Storage: ${config.name} - working ${status}\n`;
        }
      }

      // B2 存储状态
      if (validConfigs.b2) {
        result += '\n=== B2 Storage Status ===\n';
        for (const config of B2_CONFIGS) {
          const status = await deleteB2File(config, file);
          result += `B2 Storage: ${config.name} - working ${status}\n`;
        }
      }

      return new Response(result, {
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
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
    async function generateStorageRequests() {
      let requests = [];

      // 处理请求路径，保留子目录结构
      const getStoragePath = (filePath) => {
        return filePath.replace(/^\/+/, '').replace(/\/+/g, '/');
      };

      if (validConfigs.r2) {
        const r2Requests = await Promise.all(R2_CONFIGS.map(async (r2Config) => {
          // 构建包含子目录的完整路径
          const storagePath = getStoragePath(`${subPath}/${FILE}`);
          // 检查 DIR 是否为空，如果为空则直接拼接 bucket 和 storagePath。
          const r2Path = DIR ? `${r2Config.bucket}/${DIR}/${storagePath}` : `${r2Config.bucket}/${storagePath}`;
          const signedRequest = await getSignedUrl(r2Config, 'GET', r2Path);
          return {
            url: signedRequest.url,
            headers: {
              ...signedRequest.headers,
              'Accept': '*/*'
            },
            source: 'r2',
            repo: `${r2Config.name} (${r2Config.bucket})`
          };
        }));
        requests = [...requests, ...r2Requests];
      }

      if (validConfigs.b2) {
        const b2Requests = await Promise.all(B2_CONFIGS.map(async (b2Config) => {
          // 构建完整路径，注意 B2 需要包含 bucket 名称
          const storagePath = getStoragePath(`${subPath}/${FILE}`);
          const b2Path = `${b2Config.bucket}/${DIR}/${storagePath}`;

          const signedRequest = await getSignedUrl({
            endPoint: b2Config.endPoint,
            keyId: b2Config.keyId,
            applicationKey: b2Config.applicationKey,
            bucket: b2Config.bucket
          }, 'GET', b2Path);

          return {
            url: signedRequest.url,
            headers: {
              ...signedRequest.headers,
              'Host': b2Config.endPoint,
              'Accept': '*/*'
            },
            source: 'b2',
            repo: `${b2Config.name} (${b2Config.bucket})`
          };
        }));
        requests = [...requests, ...b2Requests];
      }

      return requests;
    }

    // 处理不同类型的请求
    if (from === 'where') {
      if (validConfigs.github) {
        const githubRequests = githubRepos.map(repo => ({
          url: `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${getFilePath(DIR, `${subPath}/${FILE}`)}`,
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
          // GitLab where 查询 URL
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(getFilePath(DIR, `${subPath}/${FILE}`))}?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name,
          processResponse: async (response) => {
            if (!response.ok) throw new Error('Not found');
            const data = await response.json();
            return {
              size: data.size,
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
          url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${fullPath}/${FILE}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo
        }));
      } else if (from === 'gitlab' && validConfigs.gitlab) {
        requests = GITLAB_CONFIGS.map(config => ({
          // GitLab 文件获取 URL
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(getFilePath(DIR, `${subPath}/${FILE}`))}/raw?ref=main`,
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
            url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${fullPath}/${FILE}`,
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
            // GitLab URL 构建方式
            url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(getFilePath(DIR, `${subPath}/${FILE}`))}/raw?ref=main`,
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
