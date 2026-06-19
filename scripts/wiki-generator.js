'use strict';

/**
 * Hexo Wiki Generator
 * 
 * Scans an Obsidian vault directory and generates Hexo pages under source/wiki/
 * preserving folder hierarchy, converting [[wikilinks]] to markdown links.
 * 
 * Runs on every `hexo generate`.
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const VAULT_PATH = 'D:\\AI Projects\\Obsidian Vault';
const WIKI_SOURCE_DIR = 'source/wiki';
const OBSIDIAN_HIDDEN_DIRS = ['.obsidian'];

// ─── Helper functions ────────────────────────────────────────────────────────

function walkDir(dir, basePath, relativePath = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (OBSIDIAN_HIDDEN_DIRS.includes(entry.name)) continue;
      results.push(...walkDir(fullPath, basePath, relPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push({
        fullPath,
        relativePath: relPath,
        dir: relativePath ? path.dirname(relPath) : '',
        name: entry.name,
        nameWithoutExt: entry.name.replace(/\.md$/, ''),
      });
    }
  }
  return results;
}

function parseFile(fileInfo) {
  const content = fs.readFileSync(fileInfo.fullPath, 'utf-8');
  const stats = fs.statSync(fileInfo.fullPath);
  let title = fileInfo.nameWithoutExt;
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();
  const date = stats.mtime;
  return { title, content, date };
}

function convertWikilinks(content) {
  return content.replace(/\[\[([^\]]+?)(?:\|([^\]]*?))?\]\]/g, (match, target, label) => {
    let wikiTarget = target.trim();
    const isFolder = wikiTarget.endsWith('/');
    const hasLabel = label !== undefined && label.trim() !== '';
    const outputLabel = hasLabel ? label.trim() : wikiTarget;
    let outputUrl;
    if (isFolder) {
      outputUrl = wikiTarget;
    } else {
      outputUrl = wikiTarget + '.html';
    }
    return `[${outputLabel}](${outputUrl})`;
  });
}

function buildIndexTree(allFiles) {
  const tree = {};
  for (const file of allFiles) {
    if (file.name === '00-首页.md') continue;
    const parts = file.dir ? file.dir.replace(/\\/g, '/').split('/') : [];
    let current = tree;
    for (const part of parts) {
      if (!current[part]) current[part] = {};
      current = current[part];
    }
    current[file.name] = file;
  }
  return tree;
}

function renderTree(node, depth = 0) {
  let result = '';
  const indent = '  '.repeat(depth);
  const keys = Object.keys(node).sort((a, b) => {
    const aIsFolder = typeof node[a] === 'object' && (typeof node[a].name === 'undefined');
    const bIsFolder = typeof node[b] === 'object' && (typeof node[b].name === 'undefined');
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
  for (const key of keys) {
    const value = node[key];
    const isFolder = typeof value === 'object' && value.name === undefined;
    if (isFolder) {
      const dirName = key.replace(/^\d+-/, '').replace(/-/g, ' ');
      result += `${indent}- **${dirName}**\n`;
      result += renderTree(value, depth + 1);
    } else {
      const fileUrl = value.dir
        ? `${value.dir.replace(/\\/g, '/')}/${value.nameWithoutExt}.html`
        : `${value.nameWithoutExt}.html`;
      result += `${indent}- [${value.title}](${fileUrl})\n`;
    }
  }
  return result;
}

function yamlEscape(str) {
  if (!str || typeof str !== 'string') return str;
  if (/[:\[\]{},"'&#!|>%@`*?]/.test(str) || /^[\s\-]/.test(str) || /[\s\-]$/.test(str)) {
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return str;
}

function writeWikiFiles(hexo) {
  const log = hexo.log || console;
  const baseDir = hexo.base_dir;
  const wikiSourceDir = path.join(baseDir, WIKI_SOURCE_DIR);

  log.info('Wiki Generator: Starting scan of Obsidian vault...');
  if (!fs.existsSync(VAULT_PATH)) {
    log.warn(`Wiki Generator: Vault path "${VAULT_PATH}" not found. Skipping.`);
    return;
  }

  const allFiles = walkDir(VAULT_PATH, VAULT_PATH);
  log.info(`Wiki Generator: Found ${allFiles.length} markdown files`);
  if (allFiles.length === 0) return;

  if (fs.existsSync(wikiSourceDir)) {
    fs.rmSync(wikiSourceDir, { recursive: true, force: true });
  }
  fs.mkdirSync(wikiSourceDir, { recursive: true });

  const homeFile = allFiles.find(f => f.name === '00-首页.md');
  let homeContent = null;

  for (const file of allFiles) {
    const { title, content, date } = parseFile(file);
    const convertedContent = convertWikilinks(content);

    if (file.name === '00-首页.md') {
      // Strip the heading from home content to avoid double title in index page
      homeContent = convertedContent.replace(/^#\s+.+\n+/, '');
      continue;
    }

    // Strip the first # heading to avoid double title (theme renders frontmatter title)
    const contentWithoutTitle = convertedContent.replace(/^#\s+.+\n+/, '');

    // Store title on the file object for index tree rendering
    file.title = title;

    // For other files, preserve folder structure
    const dirPart = file.dir ? file.dir.replace(/\\/g, '/') : '';
    const outputRelPath = dirPart ? `${dirPart}/${file.name}` : file.name;
    const outputPath = path.join(wikiSourceDir, outputRelPath);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const escapedTitle = yamlEscape(title);
    const dateStr = date.toISOString().split('T')[0];
    const frontmatter = `---\ntitle: ${escapedTitle}\ndate: ${dateStr}\nlayout: page\ntype: wiki\n---\n\n`;
    fs.writeFileSync(outputPath, frontmatter + contentWithoutTitle, 'utf-8');
    log.info(`Wiki Generator: Generated ${outputRelPath}`);
  }

  // Generate index.md with combined home content + directory listing
  // Use a title that won't collide with theme's home detection
  const tree = buildIndexTree(allFiles);
  const treeContent = renderTree(tree);

  let indexContent;
  let indexTitle;
  let indexDate;

  if (homeContent !== null && homeFile) {
    indexTitle = 'Wiki 知识库';
    indexContent = homeContent + '\n\n---\n\n## 所有笔记\n\n' + treeContent;
    indexDate = fs.statSync(homeFile.fullPath).mtime.toISOString().split('T')[0];
  } else {
    indexTitle = 'Wiki 知识库';
    indexContent = '# Wiki 知识库\n\n' + treeContent;
    indexDate = new Date().toISOString().split('T')[0];
  }

  const escapedTitle = yamlEscape(indexTitle);
  const frontmatter = `---\ntitle: ${escapedTitle}\ndate: ${indexDate}\nlayout: page\ntype: wiki\n---\n\n`;
  fs.writeFileSync(path.join(wikiSourceDir, 'index.md'), frontmatter + indexContent, 'utf-8');
  log.info('Wiki Generator: Updated wiki/index.md with directory listing');
  log.info('Wiki Generator: Complete!');
}

hexo.extend.filter.register('before_generate', function () {
  writeWikiFiles(this);
});
