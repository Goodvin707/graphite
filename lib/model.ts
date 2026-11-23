export type Note = {
  id: string
  title: string
  content: string
  folder: string
  createdAt: number
  updatedAt: number
}

export type VaultOrigin = "sample" | "user" | "import" | "empty"

export type Vault = {
  version: 1
  name: string
  origin: VaultOrigin
  notes: Note[]
}

export type WikiLink = {
  title: string
  alias: string | null
  line: number
  excerpt: string
}

export type ParsedNote = {
  links: WikiLink[]
  tags: string[]
}

export type GraphSettings = {
  mode: "global" | "local"
  depth: number
  folders: string[]
  tags: string[]
  showOrphans: boolean
  showGhosts: boolean
  showTagNodes: boolean
  labels: "auto" | "always" | "never"
  colorBy: "folder" | "tag"
  charge: number
  distance: number
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  mode: "global",
  depth: 1,
  folders: [],
  tags: [],
  showOrphans: true,
  showGhosts: true,
  showTagNodes: false,
  labels: "auto",
  colorBy: "folder",
  charge: -190,
  distance: 84,
}

export const FOLDER_COLORS: Record<string, string> = {
  "": "#d9d3c5",
  Сад: "#8fbf6a",
  Чтение: "#e0a45a",
  Проекты: "#6eb0d4",
  Люди: "#e08a98",
  Методы: "#b79adf",
}

const TAG_PALETTE = [
  "#e0a45a",
  "#8fbf6a",
  "#6eb0d4",
  "#e08a98",
  "#b79adf",
  "#7dccb8",
  "#d2c46a",
  "#d48a5a",
]

export type GraphNodeData = {
  id: string
  kind: "note" | "ghost" | "tag"
  title: string
  folder: string
  tags: string[]
  color: string
  degree: number
  realDegree: number
  noteId?: string
  excerpt: string
  referrers: string[]
}

export type GraphLinkData = {
  source: string
  target: string
  forward: number
  back: number
  kind: "note" | "ghost" | "tag"
}

export type GraphData = {
  nodes: GraphNodeData[]
  links: GraphLinkData[]
}

export type OutgoingLink = {
  title: string
  missing: boolean
  excerpt: string
  noteId?: string
}

export type IncomingLink = {
  noteId: string
  title: string
  excerpt: string
}

export type LinkInfo = {
  outgoing: OutgoingLink[]
  incoming: IncomingLink[]
  mentions: IncomingLink[]
  tags: string[]
}

const VAULT_KEY = "nit-vault-v1"
const MAX_NOTES = 800
const MAX_NOTE_CHARS = 80_000

export function createId() {
  return `n-${crypto.randomUUID()}`
}

export function hashColor(seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}

export function colorForFolder(folder: string) {
  return FOLDER_COLORS[folder] ?? hashColor(folder.toLowerCase())
}

export function folderLabel(folder: string) {
  return folder || "Без папки"
}

export function validateTitle(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return "Нужно название"
  if (trimmed.length > 200) return "Слишком длинное название"
  if (/[\[\]|#]/.test(trimmed)) return "В названии не нужны символы [ ] | #"
  return null
}

export function validateFolder(folder: string) {
  const trimmed = folder.trim()
  if (trimmed.length > 80) return "Слишком длинное имя папки"
  if (/[\\/]/.test(trimmed)) return "Папка без слэша — один уровень"
  return null
}

function isWordChar(char: string) {
  return /[\p{L}\p{N}_]/u.test(char)
}

function mapOutsideInline(line: string, fn: (plain: string) => string) {
  return line
    .split(/(`[^`]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : fn(part)))
    .join("")
}

function cleanLine(line: string) {
  return line
    .replace(/\[\[([^\[\]|#]+?)(?:#[^\[\]|]+)?(?:\|([^\[\]]+))?\]\]/g, (_, title: string, alias?: string) => alias?.trim() || title.trim())
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*_~`]/g, "")
    .trim()
    .slice(0, 180)
}

export function parseNote(content: string): ParsedNote {
  const links: WikiLink[] = []
  const tags: string[] = []
  const seenTags = new Set<string>()
  let fence = false

  for (const [index, line] of content.split("\n").entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const plain = line.replace(/`[^`]*`/g, " ")
    for (const match of plain.matchAll(/\[\[([^\[\]|#]+?)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]/g)) {
      const title = match[1]?.trim() ?? ""
      if (!title) continue
      links.push({
        title,
        alias: match[3]?.trim() || null,
        line: index,
        excerpt: cleanLine(line),
      })
    }
    for (const match of plain.matchAll(/(^|[\s([{])#([\p{L}\p{N}_/-]+)/gu)) {
      const tag = match[2]
      if (!tag) continue
      const key = tag.toLowerCase()
      if (seenTags.has(key)) continue
      seenTags.add(key)
      tags.push(tag)
    }
  }

  return { links, tags }
}

export function excerptOf(content: string) {
  for (const line of content.split("\n")) {
    const clean = cleanLine(line)
    if (!clean) continue
    return clean.slice(0, 160)
  }
  return ""
}

export function rewriteWikilinks(content: string, from: string, to: string) {
  const target = from.trim().toLowerCase()
  let fence = false
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence
        return line
      }
      if (fence) return line
      return mapOutsideInline(line, (part) =>
        part.replace(/\[\[([^\[\]|#]+?)(#[^\[\]|]+)?(\|[^\]]+)?\]\]/g, (full, title: string, hash = "", alias = "") => {
          if (title.trim().toLowerCase() !== target) return full
          return `[[${to}${hash}${alias}]]`
        }),
      )
    })
    .join("\n")
}

function replaceFirstMention(segment: string, title: string) {
  if (segment.toLowerCase().length !== segment.length || title.toLowerCase().length !== title.length) {
    return { text: segment, changed: false }
  }
  const masked = segment.replace(/\[\[[\s\S]*?\]\]/g, (match) => " ".repeat(match.length))
  const lower = masked.toLowerCase()
  const needle = title.toLowerCase()
  let index = 0
  while (index < segment.length) {
    const found = lower.indexOf(needle, index)
    if (found === -1) break
    const before = found > 0 ? segment[found - 1] : ""
    const after = segment[found + title.length] ?? ""
    if ((before && isWordChar(before)) || (after && isWordChar(after))) {
      index = found + needle.length
      continue
    }
    return {
      text: `${segment.slice(0, found)}[[${title}]]${segment.slice(found + title.length)}`,
      changed: true,
    }
  }
  return { text: segment, changed: false }
}

export function linkifyFirstMention(content: string, title: string) {
  let fence = false
  let changed = false
  const lines = content.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      return line
    }
    if (fence || changed) return line
    const next = mapOutsideInline(line, (part) => {
      if (changed) return part
      const replaced = replaceFirstMention(part, title)
      if (replaced.changed) changed = true
      return replaced.text
    })
    return next
  })
  return { content: lines.join("\n"), changed }
}

function mentionOutsideLinks(content: string, title: string) {
  if (title.trim().length < 4) return null
  let fence = false
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const hit = mapOutsideInline(line, (part) => (replaceFirstMention(part, title).changed ? "1" : "0"))
    if (hit.includes("1")) return cleanLine(line)
  }
  return null
}

export function describeLinks(notes: Note[], note: Note): LinkInfo {
  const parsed = new Map(notes.map((item) => [item.id, parseNote(item.content)]))
  const byTitle = new Map(notes.map((item) => [item.title.trim().toLowerCase(), item]))
  const own = parsed.get(note.id) ?? { links: [], tags: [] }
  const outgoing: OutgoingLink[] = []
  const seenOut = new Set<string>()

  for (const link of own.links) {
    const key = link.title.toLowerCase()
    if (seenOut.has(key) || key === note.title.trim().toLowerCase()) continue
    seenOut.add(key)
    const target = byTitle.get(key)
    outgoing.push({
      title: target?.title ?? link.title,
      missing: !target,
      excerpt: link.excerpt,
      noteId: target?.id,
    })
  }

  const incoming: IncomingLink[] = []
  const mentions: IncomingLink[] = []
  for (const other of notes) {
    if (other.id === note.id) continue
    const links = parsed.get(other.id)?.links ?? []
    const hit = links.find((link) => link.title.toLowerCase() === note.title.trim().toLowerCase())
    if (hit) {
      incoming.push({ noteId: other.id, title: other.title, excerpt: hit.excerpt })
      continue
    }
    const excerpt = mentionOutsideLinks(other.content, note.title.trim())
    if (excerpt) mentions.push({ noteId: other.id, title: other.title, excerpt })
  }

  return { outgoing, incoming, mentions: mentions.slice(0, 12), tags: own.tags }
}

export function buildGraph(notes: Note[], settings: GraphSettings & { focusId?: string | null }): GraphData {
  const byTitle = new Map<string, Note>()
  for (const note of notes) {
    const key = note.title.trim().toLowerCase()
    if (!byTitle.has(key)) byTitle.set(key, note)
  }
  const parsed = new Map(notes.map((note) => [note.id, parseNote(note.content)]))
  const folderOn = settings.folders.length === 0 ? null : new Set(settings.folders)
  const tagOn = settings.tags.length === 0 ? null : new Set(settings.tags.map((tag) => tag.toLowerCase()))

  const allowed = notes.filter((note) => {
    if (folderOn && !folderOn.has(note.folder)) return false
    if (tagOn) {
      const tags = parsed.get(note.id)?.tags ?? []
      if (!tags.some((tag) => tagOn.has(tag.toLowerCase()))) return false
    }
    return true
  })
  const allowedIds = new Set(allowed.map((note) => note.id))
  const neighbors = new Map<string, Set<string>>()
  const touch = (id: string) => {
    let set = neighbors.get(id)
    if (!set) neighbors.set(id, (set = new Set()))
    return set
  }

  const ghostNames = new Map<string, string>()
  const directed: { from: string; to: string; kind: "note" | "ghost" }[] = []

  for (const note of allowed) {
    for (const link of parsed.get(note.id)?.links ?? []) {
      const key = link.title.toLowerCase()
      const target = byTitle.get(key)
      if (target && target.id !== note.id && allowedIds.has(target.id)) {
        touch(note.id).add(target.id)
        touch(target.id).add(note.id)
        directed.push({ from: note.id, to: target.id, kind: "note" })
      } else if (!target) {
        const ghostId = `ghost:${key}`
        if (!ghostNames.has(ghostId)) ghostNames.set(ghostId, link.title.trim())
        directed.push({ from: note.id, to: ghostId, kind: "ghost" })
      }
    }
  }

  let selected = new Set<string>()
  if (settings.mode === "local") {
    const focus = settings.focusId
    if (focus && allowedIds.has(focus)) {
      const queue: { id: string; depth: number }[] = [{ id: focus, depth: 0 }]
      selected.add(focus)
      let head = 0
      while (head < queue.length) {
        const current = queue[head++]
        if (!current || current.depth >= settings.depth) continue
        for (const next of neighbors.get(current.id) ?? []) {
          if (selected.has(next)) continue
          selected.add(next)
          queue.push({ id: next, depth: current.depth + 1 })
        }
      }
    }
  } else {
    selected = new Set(allowedIds)
  }

  if (!settings.showOrphans) {
    for (const id of [...selected]) {
      if (settings.mode === "local" && id === settings.focusId) continue
      if ((neighbors.get(id)?.size ?? 0) === 0) selected.delete(id)
    }
  }

  const noteById = new Map(notes.map((note) => [note.id, note]))
  const referrers = new Map<string, string[]>()
  const remember = (id: string, title: string) => {
    const list = referrers.get(id) ?? []
    if (!list.includes(title)) list.push(title)
    referrers.set(id, list)
  }

  type Bucket = GraphLinkData
  const buckets = new Map<string, Bucket>()
  const addEdge = (from: string, to: string, kind: GraphLinkData["kind"]) => {
    const source = from < to ? from : to
    const target = from < to ? to : from
    const key = `${source}\0${target}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { source, target, forward: 0, back: 0, kind }
      buckets.set(key, bucket)
    }
    if (from === source) bucket.forward += 1
    else bucket.back += 1
  }

  for (const edge of directed) {
    if (!selected.has(edge.from)) continue
    if (edge.kind === "note" && !selected.has(edge.to)) continue
    if (edge.kind === "ghost" && !settings.showGhosts) continue
    addEdge(edge.from, edge.to, edge.kind)
    const fromNote = noteById.get(edge.from)
    if (fromNote) remember(edge.to, fromNote.title)
  }

  if (settings.showTagNodes) {
    const tagIds = new Map<string, string>()
    for (const id of selected) {
      const note = noteById.get(id)
      if (!note) continue
      for (const tag of parsed.get(id)?.tags ?? []) {
        const key = tag.toLowerCase()
        const tagId = `tag:${key}`
        tagIds.set(tagId, tagIds.get(tagId) ?? tag)
        addEdge(id, tagId, "tag")
        remember(tagId, note.title)
      }
    }
    for (const [tagId, label] of tagIds) {
      ghostNames.set(tagId, label)
    }
  }

  const degree = new Map<string, number>()
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)
  for (const link of buckets.values()) {
    bump(link.source)
    bump(link.target)
  }

  const realDegree = new Map<string, number>()
  for (const id of selected) {
    realDegree.set(id, [...(neighbors.get(id) ?? [])].filter((next) => selected.has(next)).length)
  }

  const nodes: GraphNodeData[] = []
  for (const id of selected) {
    const note = noteById.get(id)
    if (!note) continue
    const tags = parsed.get(note.id)?.tags ?? []
    const color =
      settings.colorBy === "tag" && tags[0] ? hashColor(tags[0].toLowerCase()) : colorForFolder(note.folder)
    nodes.push({
      id: note.id,
      kind: "note",
      title: note.title,
      folder: note.folder,
      tags,
      color,
      degree: degree.get(note.id) ?? 0,
      realDegree: realDegree.get(note.id) ?? 0,
      noteId: note.id,
      excerpt: excerptOf(note.content),
      referrers: referrers.get(note.id) ?? [],
    })
  }

  const ghostIds = new Set<string>()
  for (const link of buckets.values()) {
    for (const id of [link.source, link.target]) {
      if (id.startsWith("ghost:") || id.startsWith("tag:")) ghostIds.add(id)
    }
  }
  for (const id of ghostIds) {
    const isTag = id.startsWith("tag:")
    const title = isTag ? `#${ghostNames.get(id) ?? id.slice(4)}` : (ghostNames.get(id) ?? id.slice(6))
    nodes.push({
      id,
      kind: isTag ? "tag" : "ghost",
      title,
      folder: "",
      tags: isTag ? [ghostNames.get(id) ?? ""] : [],
      color: isTag ? "#c7b6ea" : "#8a8678",
      degree: degree.get(id) ?? 0,
      realDegree: 0,
      excerpt: isTag ? "Тег, собранный в узел" : "Заметки ещё нет — на неё только ссылаются",
      referrers: referrers.get(id) ?? [],
    })
  }

  return { nodes, links: [...buckets.values()] }
}

export function listFolders(notes: Note[]) {
  const counts = new Map<string, number>()
  for (const note of notes) counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1)
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => folderLabel(a.folder).localeCompare(folderLabel(b.folder), "ru"))
}

export function listTags(notes: Note[]) {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const note of notes) {
    for (const tag of parseNote(note.content).tags) {
      const key = tag.toLowerCase()
      const current = counts.get(key)
      if (current) current.count += 1
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ru"))
}

export function searchNotes(notes: Note[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: { note: Note; score: number; snippet: string }[] = []
  for (const note of notes) {
    const title = note.title.toLowerCase()
    const tags = parseNote(note.content).tags
    const contentIndex = note.content.toLowerCase().indexOf(needle)
    let score = 99
    if (title.startsWith(needle)) score = 0
    else if (title.includes(needle)) score = 1
    else if (tags.some((tag) => tag.toLowerCase().includes(needle))) score = 2
    else if (contentIndex >= 0) score = 3
    else continue
    hits.push({ note, score, snippet: snippetAround(note.content, needle) })
  }
  hits.sort((a, b) => a.score - b.score || b.note.updatedAt - a.note.updatedAt)
  return hits.slice(0, 8)
}

function snippetAround(content: string, needle: string) {
  const lower = content.toLowerCase()
  const index = lower.indexOf(needle)
  if (index < 0) return excerptOf(content)
  const start = Math.max(0, index - 48)
  const end = Math.min(content.length, index + needle.length + 72)
  const slice = content.slice(start, end).replace(/\s+/g, " ").trim()
  return `${start > 0 ? "…" : ""}${slice}${end < content.length ? "…" : ""}`
}

export function sanitizeVault(value: unknown): Vault | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<Vault>
  if (raw.version !== 1 || !Array.isArray(raw.notes)) return null
  if (raw.notes.length > MAX_NOTES) return null
  const notes: Note[] = []
  const seen = new Set<string>()
  for (const item of raw.notes) {
    if (!item || typeof item !== "object") return null
    const note = item as Partial<Note>
    if (typeof note.id !== "string" || typeof note.title !== "string" || typeof note.content !== "string") return null
    if (note.content.length > MAX_NOTE_CHARS || note.title.length > 200) return null
    const title = note.title.trim()
    if (!title || /[\[\]|#]/.test(title)) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const folder = typeof note.folder === "string" ? note.folder.trim().slice(0, 80) : ""
    notes.push({
      id: note.id.slice(0, 80),
      title,
      content: note.content,
      folder: /[\\/]/.test(folder) ? "" : folder,
      createdAt: typeof note.createdAt === "number" && Number.isFinite(note.createdAt) ? note.createdAt : Date.now(),
      updatedAt: typeof note.updatedAt === "number" && Number.isFinite(note.updatedAt) ? note.updatedAt : Date.now(),
    })
  }
  const origins: VaultOrigin[] = ["sample", "user", "import", "empty"]
  const origin = origins.includes(raw.origin as VaultOrigin) ? (raw.origin as VaultOrigin) : "user"
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : "Мои заметки"
  return { version: 1, name, origin, notes }
}

export function loadVault(): Vault {
  if (typeof window === "undefined") return emptyVaultShell()
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw) return emptyVaultShell()
    return sanitizeVault(JSON.parse(raw) as unknown) ?? emptyVaultShell()
  } catch {
    return emptyVaultShell()
  }
}

function emptyVaultShell(): Vault {
  return { version: 1, name: "", origin: "empty", notes: [] }
}

export function vaultExists() {
  if (typeof window === "undefined") return false
  return localStorage.getItem(VAULT_KEY) !== null
}

export function saveVault(vault: Vault) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault))
}

export function loadGraphSettings(): GraphSettings {
  if (typeof window === "undefined") return DEFAULT_GRAPH_SETTINGS
  try {
    const raw = localStorage.getItem("nit-graph-v1")
    if (!raw) return DEFAULT_GRAPH_SETTINGS
    const parsed = JSON.parse(raw) as Partial<GraphSettings>
    return {
      ...DEFAULT_GRAPH_SETTINGS,
      ...parsed,
      mode: parsed.mode === "local" ? "local" : "global",
      depth: parsed.depth === 2 || parsed.depth === 3 ? parsed.depth : 1,
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter((item) => typeof item === "string").slice(0, 40) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((item) => typeof item === "string").slice(0, 40) : [],
      labels: parsed.labels === "always" || parsed.labels === "never" ? parsed.labels : "auto",
      colorBy: parsed.colorBy === "tag" ? "tag" : "folder",
      charge: clampNumber(parsed.charge, -520, -40, DEFAULT_GRAPH_SETTINGS.charge),
      distance: clampNumber(parsed.distance, 36, 180, DEFAULT_GRAPH_SETTINGS.distance),
      showOrphans: parsed.showOrphans !== false,
      showGhosts: parsed.showGhosts !== false,
      showTagNodes: parsed.showTagNodes === true,
    }
  } catch {
    return DEFAULT_GRAPH_SETTINGS
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function saveGraphSettings(settings: GraphSettings) {
  localStorage.setItem("nit-graph-v1", JSON.stringify(settings))
}

export function relativeTime(timestamp: number, now = Date.now()) {
  const minutes = Math.round((now - timestamp) / 60000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} дн назад`
  return new Date(timestamp).toLocaleDateString("ru-RU")
}

export function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|]/g, "\\$&")
}

export function toMarkdownSource(content: string, titles: Set<string>) {
  let fence = false
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence
        return line
      }
      if (fence) return line
      const withTags = mapOutsideInline(line, (part) =>
        part.replace(/(^|[\s([{])#([\p{L}\p{N}_/-]+)/gu, (_, lead: string, tag: string) => {
          return `${lead}[#${tag}](tag:${encodeURIComponent(tag)})`
        }),
      )
      return mapOutsideInline(withTags, (part) =>
        part.replace(/\[\[([^\[\]|#]+?)(?:#[^\[\]|]+)?(?:\|([^\[\]]+))?\]\]/g, (_, title: string, alias?: string) => {
          const clean = title.trim()
          const label = escapeMarkdown((alias?.trim() || clean) || "заметка")
          const missing = titles.has(clean.toLowerCase()) ? "" : "?missing=1"
          return `[${label}](wiki:${encodeURIComponent(clean)}${missing})`
        }),
      )
    })
    .join("\n")
}
