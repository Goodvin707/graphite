import assert from "node:assert/strict"
import test from "node:test"
import { createSampleVault } from "./sample-vault.ts"
import {
  buildGraph,
  DEFAULT_GRAPH_SETTINGS,
  describeLinks,
  linkifyFirstMention,
  parseNote,
  rewriteWikilinks,
  sanitizeVault,
} from "./model.ts"

test("parse ignores fences, inline code and headings", () => {
  const parsed = parseNote(
    ["Видно [[Почва]] и #сад", "```", "[[Скрыто]] #нет", "```", "код `[[Тоже]]` и `#скрытый`", "# Заголовок", "#тег"].join("\n"),
  )
  assert.deepEqual(
    parsed.links.map((link) => link.title),
    ["Почва"],
  )
  assert.deepEqual(parsed.tags, ["сад", "тег"])
})

test("rewrite keeps aliases and skips code", () => {
  const source = ["```", "[[Почва]]", "```", "См. [[Почва#Слои|слои]] и [[почва]]."].join("\n")
  const next = rewriteWikilinks(source, "почва", "Земля")
  assert.match(next, /```\n\[\[Почва\]\]\n```/)
  assert.match(next, /\[\[Земля#Слои\|слои\]\]/)
  assert.match(next, /\[\[Земля\]\]\./)
})

test("linkify skips existing wikilinks and word parts", () => {
  const first = linkifyFirstMention("Почва, потом ещё.", "Почва")
  assert.equal(first.content, "[[Почва]], потом ещё.")
  const second = linkifyFirstMention("Уже [[Почва]] и потом Почва.", "Почва")
  assert.equal(second.content, "Уже [[Почва]] и потом [[Почва]].")
  const inside = linkifyFirstMention("Это неПочва и Почвам.", "Почва")
  assert.equal(inside.changed, false)
})

test("sample vault graph has the intended holes and clusters", () => {
  const vault = createSampleVault()
  const titles = vault.notes.map((note) => note.title.toLowerCase())
  assert.equal(new Set(titles).size, titles.length)

  const graph = buildGraph(vault.notes, { ...DEFAULT_GRAPH_SETTINGS, focusId: null })
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.kind === "ghost")
      .map((node) => node.title)
      .sort((a, b) => a.localeCompare(b, "ru")),
    ["Глубокая работа", "Дождевые черви", "Микориза"],
  )
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.kind === "note" && node.realDegree === 0)
      .map((node) => node.title)
      .sort((a, b) => a.localeCompare(b, "ru")),
    ["Запах дождя", "Список на субботу"],
  )
  assert.ok(graph.links.length > 40)

  const masha = vault.notes.find((note) => note.title === "Маша")
  assert.ok(masha)
  const local = buildGraph(vault.notes, { ...DEFAULT_GRAPH_SETTINGS, mode: "local", depth: 1, focusId: masha.id })
  assert.deepEqual(
    local.nodes
      .filter((node) => node.kind === "note")
      .map((node) => node.title)
      .sort((a, b) => a.localeCompare(b, "ru")),
    ["Грядка у южной стены", "Карта мастерской", "Компост", "Курс для соседей", "Маша", "Сад без суеты", "Соседская библиотека"],
  )
  const wider = buildGraph(vault.notes, { ...DEFAULT_GRAPH_SETTINGS, mode: "local", depth: 2, focusId: masha.id })
  assert.ok(wider.nodes.some((node) => node.title === "Почва"))

  const info = describeLinks(vault.notes, masha)
  assert.ok(info.outgoing.some((link) => link.title === "Компост"))
  assert.ok(info.incoming.some((link) => link.title === "Компост"))
})

test("sanitize drops duplicate titles and rejects garbage", () => {
  assert.equal(sanitizeVault({ version: 2, notes: [] }), null)
  const clean = sanitizeVault({
    version: 1,
    name: "Тест",
    origin: "import",
    notes: [
      { id: "a", title: "Одна", content: "текст", folder: "Сад", createdAt: 1, updatedAt: 2 },
      { id: "b", title: " одна ", content: "дубль", folder: "Сад", createdAt: 1, updatedAt: 2 },
      { id: "c", title: "Две", content: "[[Одна]]", folder: "Папка/лишняя", createdAt: 1, updatedAt: 2 },
    ],
  })
  assert.ok(clean)
  assert.equal(clean.notes.length, 2)
  assert.equal(clean.notes[1]?.folder, "")
  assert.equal(clean.name, "Тест")
})
