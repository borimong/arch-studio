// 로컬 코드 폴더를 훑어서 아키텍처 추론에 필요한 단서만 모은다.
// 비밀값 파일은 읽지 않고, 읽은 내용에서도 키처럼 보이는 문자열은 가린 뒤 모델에 보낸다.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'out', 'outputs', '.next', '.nuxt', '.svelte-kit',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.idea', '.vscode',
  'coverage', '.gradle', '.terraform', 'vendor', 'Pods', 'DerivedData', '.cache', 'tmp', 'logs',
]);

// 이름만 봐도 비밀값일 수 있는 파일은 아예 열지 않는다.
const SECRET_FILE = [/^\.env/i, /\.(pem|key|p12|pfx|jks|keystore|crt)$/i, /id_(rsa|ed25519)/i, /secret/i, /credential/i, /\.npmrc$/i, /\.netrc$/i];

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.pdf', '.zip', '.gz', '.tar', '.jar', '.class',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.mp3', '.wav', '.lock', '.map', '.min.js', '.pyc',
  '.so', '.dylib', '.exe', '.bin', '.parquet', '.csv', '.xlsx', '.pptx', '.docx', '.ipynb', '.sqlite', '.db',
]);
const SKIP_NAME = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock', 'Cargo.lock', '.DS_Store']);

const SOURCE_EXT = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.java', '.kt', '.go', '.rs', '.rb', '.php', '.cs', '.swift', '.dart']);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /lsv2_[A-Za-z0-9_]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
const SECRET_ASSIGN = /((?:password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)["']?\s*[:=]\s*)(["']?)([^\s"',}]{4,})/gi;

const MAX_FILES_SEEN = 5000;
const MAX_TREE_LINES = 420;
const BUDGET_CHARS = 90_000;
const IMPORT_BUDGET = 18_000;

export function redact(text) {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '***');
  return out.replace(SECRET_ASSIGN, (_m, key, quote) => `${key}${quote}***`);
}

const isSecretFile = (name) => SECRET_FILE.some((re) => re.test(name));

function skipFile(name) {
  if (SKIP_NAME.has(name) || isSecretFile(name)) return true;
  const lower = name.toLowerCase();
  return [...SKIP_EXT].some((ext) => lower.endsWith(ext));
}

// 아키텍처를 가장 잘 드러내는 파일일수록 점수가 높다. 예산 안에서 높은 순으로 본문을 넣는다.
function priority(rel) {
  const name = path.basename(rel).toLowerCase();
  const depth = rel.split(path.sep).length - 1;
  const shallow = Math.max(0, 3 - depth) * 4;
  if (/^(docker-)?compose.*\.ya?ml$/.test(name)) return 100 + shallow;
  if (/^readme/.test(name)) return (depth === 0 ? 95 : 55) + shallow;
  if (/^(package\.json|pom\.xml|build\.gradle(\.kts)?|requirements.*\.txt|pyproject\.toml|go\.mod|cargo\.toml|gemfile|composer\.json)$/.test(name)) return 80 + shallow;
  if (/^dockerfile/.test(name) || name.endsWith('.dockerfile')) return 70 + shallow;
  if (/(^|\/)(k8s|kubernetes|helm|deploy|infra|terraform)\//i.test(rel) && /\.(ya?ml|tf)$/.test(name)) return 62;
  if (/nginx.*\.conf$|^caddyfile$/.test(name)) return 60;
  if (/^application.*\.(ya?ml|properties)$/.test(name)) return 58;
  if (/^(architecture|design|adr).*\.md$/.test(name)) return 57;
  if (/^(main|app|server|index|worker|builder|graph|router|routes)\.(py|js|ts|go|rs)$/.test(name)) return 52 + shallow;
  if (/application\.(java|kt)$/.test(name)) return 52;
  if (/(controller|router|routes|gateway|client|consumer|producer|listener|config)\./i.test(name)) return 40;
  if (/^(vite|next|nuxt|webpack|tsconfig)\.config/.test(name) || name === 'tsconfig.json') return 30;
  if (/\.(ya?ml|toml)$/.test(name) && depth <= 2) return 28;
  if (/schema\.(sql|prisma|graphql)$|\.proto$/.test(name)) return 45;
  return 0;
}

async function walk(root) {
  const files = [];
  const dirs = [];
  const queue = [[root, 0]];
  while (queue.length && files.length < MAX_FILES_SEEN) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
        if (depth < 9) {
          dirs.push(rel);
          queue.push([full, depth + 1]);
        }
      } else if (e.isFile() && !skipFile(e.name)) {
        files.push(rel);
      }
    }
  }
  return { files, dirs };
}

// 폴더별로 파일을 몇 개만 보여 주는 압축 트리. 모델이 모듈 경계를 파악하는 용도다.
function buildTree(files) {
  const byDir = new Map();
  for (const f of files) {
    const d = path.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(path.basename(f));
  }
  const lines = [];
  for (const d of [...byDir.keys()].sort()) {
    const names = byDir.get(d);
    const shown = names.slice(0, 10).join(', ');
    const more = names.length > 10 ? ` 외 ${names.length - 10}개` : '';
    lines.push(`${d === '.' ? '(루트)' : d}/: ${shown}${more}`);
    if (lines.length >= MAX_TREE_LINES) {
      lines.push(`... 폴더 ${byDir.size - lines.length}개 생략`);
      break;
    }
  }
  return lines.join('\n');
}

const IMPORT_LINE = /^\s*(import\s.+|from\s+\S+\s+import\s.+|const\s+\w+\s*=\s*require\(.+\)|require\s*\(.+\)|use\s+[\w:]+.*;|@(Get|Post|Put|Delete|Request|Patch)Mapping.*|@(app|router)\.(get|post|put|delete|patch)\(.+|@RabbitListener.*|@KafkaListener.*|@FeignClient.*|@mcp\.tool.*)$/;

async function readText(full, limit) {
  const stat = await fs.stat(full);
  if (stat.size > 400_000) return null;
  const raw = await fs.readFile(full, 'utf8');
  if (raw.includes('\u0000')) return null;
  return raw.length > limit ? `${raw.slice(0, limit)}\n... (이하 ${raw.length - limit}자 생략)` : raw;
}

export async function scanProject(root) {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw Object.assign(new Error('폴더를 찾을 수 없습니다'), { status: 400 });

  const { files } = await walk(root);
  if (!files.length) throw Object.assign(new Error('읽을 수 있는 코드 파일이 없습니다'), { status: 400 });

  const ranked = files
    .map((rel) => ({ rel, score: priority(rel) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);

  const picked = [];
  let used = 0;
  for (const { rel, score } of ranked) {
    if (used >= BUDGET_CHARS) break;
    const limit = score >= 90 ? 9000 : score >= 60 ? 5000 : 3500;
    const text = await readText(path.join(root, rel), Math.min(limit, BUDGET_CHARS - used)).catch(() => null);
    if (!text?.trim()) continue;
    const content = redact(text);
    picked.push({ path: rel, content });
    used += content.length;
  }

  // 본문을 넣지 못한 소스 파일은 import와 라우트 선언만 모아서 모듈 사이 의존을 보여 준다.
  const pickedSet = new Set(picked.map((p) => p.path));
  const importLines = [];
  let importUsed = 0;
  for (const rel of files) {
    if (importUsed >= IMPORT_BUDGET) break;
    if (pickedSet.has(rel) || !SOURCE_EXT.has(path.extname(rel))) continue;
    if (/(^|\/)(tests?|__tests__|spec|fixtures?|mocks?)\//i.test(rel)) continue;
    const text = await readText(path.join(root, rel), 20_000).catch(() => null);
    if (!text) continue;
    const hits = text.split('\n').filter((l) => IMPORT_LINE.test(l)).slice(0, 14).map((l) => l.trim().slice(0, 160));
    if (!hits.length) continue;
    const block = `${rel}: ${redact(hits.join(' | '))}`;
    importLines.push(block);
    importUsed += block.length;
  }

  return {
    root,
    name: path.basename(root),
    tree: buildTree(files),
    files: picked,
    imports: importLines.join('\n'),
    stats: { filesSeen: files.length, filesRead: picked.length, importFiles: importLines.length, chars: used + importUsed },
  };
}

export function scanToPrompt(scan) {
  const parts = [`# 폴더: ${scan.name}`, '## 폴더 구조', scan.tree, '## 주요 파일 본문'];
  for (const f of scan.files) parts.push(`### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
  if (scan.imports) parts.push('## 나머지 소스의 import와 라우트 선언', scan.imports);
  return parts.join('\n\n');
}

// 폴더 선택 창에서 쓰는 하위 폴더 목록. 숨김 폴더와 의존성 폴더는 보여 주지 않는다.
export async function listDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}
