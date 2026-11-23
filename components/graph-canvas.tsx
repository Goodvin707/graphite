"use client"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { GraphData, GraphLinkData, GraphNodeData, GraphSettings, Note } from "@/lib/model"
import { dismissHint, getHintVisible, subscribeHint } from "@/lib/browser-store"
import { buildGraph, colorForFolder, folderLabel } from "@/lib/model"
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force"
import { Crosshair, Download, LocateFixed, Plus, RotateCcw, Settings2, Shrink } from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

type GNode = SimulationNodeDatum &
  GraphNodeData & {
    r: number
    pinned: boolean
  }

type GLink = SimulationLinkDatum<GNode> & Pick<GraphLinkData, "forward" | "back" | "kind">

type Transform = { x: number; y: number; k: number }

type MenuState = { x: number; y: number; id: string }

type Props = {
  notes: Note[]
  focusId: string | null
  query: string
  settings: GraphSettings
  onSettings: (settings: GraphSettings) => void
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  onFocusNote: (id: string) => void
}

const LAYOUT_KEY = "nit-layout-v1"

type SavedLayout = Record<string, { x: number; y: number; pinned?: boolean }>

function radiusOf(node: GraphNodeData) {
  if (node.kind === "ghost") return 5.5
  if (node.kind === "tag") return 7
  return Math.min(26, 6.2 + Math.sqrt(node.degree) * 3.5)
}

function withAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "")
  if (h.length !== 6) return `rgba(220,214,200,${alpha})`
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function asNode(value: GLink["source"]) {
  return value as GNode
}

function loadLayout(): SavedLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SavedLayout
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveLayout(nodes: GNode[]) {
  const stored: SavedLayout = {}
  for (const node of nodes) {
    if (node.x == null || node.y == null) continue
    stored[node.id] = { x: node.x, y: node.y, pinned: node.fx != null }
  }
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(stored))
}

export function GraphCanvas({ notes, focusId, query, settings, onSettings, onOpenNote, onCreateNote, onFocusNote }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [nonce, setNonce] = useState(0)
  const reseed = useRef(false)
  const propsRef = useRef({ notes, settings, focusId })
  const skipCharge = useRef(true)

  const world = useRef({
    nodes: [] as GNode[],
    links: [] as GLink[],
    adj: new Map<string, Set<string>>(),
    sim: null as Simulation<GNode, GLink> | null,
    transform: { x: 0, y: 0, k: 1 } as Transform,
    hoverId: null as string | null,
    selectedId: null as string | null,
    query: "",
    labels: settings.labels,
    width: 0,
    height: 0,
    dpr: 1,
    font: "sans-serif",
    fitted: false,
    draw: () => {},
    releasePins: () => {},
  })

  const openRef = useRef(onOpenNote)
  const createRef = useRef(onCreateNote)
  const hint = useSyncExternalStore(subscribeHint, getHintVisible, () => false)

  const structureKey = useMemo(() => {
    return JSON.stringify({
      notes: notes.map((note) => [note.id, note.title, note.folder, note.content]),
      mode: settings.mode,
      depth: settings.depth,
      folders: settings.folders,
      tags: settings.tags,
      showOrphans: settings.showOrphans,
      showGhosts: settings.showGhosts,
      showTagNodes: settings.showTagNodes,
      colorBy: settings.colorBy,
      focusId,
      nonce,
    })
  }, [
    notes,
    settings.mode,
    settings.depth,
    settings.folders,
    settings.tags,
    settings.showOrphans,
    settings.showGhosts,
    settings.showTagNodes,
    settings.colorBy,
    focusId,
    nonce,
  ])

  useEffect(() => {
    propsRef.current = { notes, settings, focusId }
    openRef.current = onOpenNote
    createRef.current = onCreateNote
    world.current.query = query
    world.current.labels = settings.labels
    world.current.selectedId = selectedId
  }, [notes, settings, focusId, onOpenNote, onCreateNote, query, selectedId])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const bag = world.current
    const { notes: graphNotes, settings: graphSettings, focusId: graphFocus } = propsRef.current
    let stopped = false

    const measure = () => {
      const rect = host.getBoundingClientRect()
      bag.width = rect.width
      bag.height = rect.height
      bag.dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(rect.width * bag.dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * bag.dpr))
      bag.font = getComputedStyle(document.body).fontFamily || "sans-serif"
    }

    const fit = () => {
      if (!bag.nodes.length || bag.width < 40 || bag.height < 40) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of bag.nodes) {
        const x = node.x ?? 0
        const y = node.y ?? 0
        minX = Math.min(minX, x - node.r)
        minY = Math.min(minY, y - node.r)
        maxX = Math.max(maxX, x + node.r)
        maxY = Math.max(maxY, y + node.r)
      }
      const dx = Math.max(80, maxX - minX)
      const dy = Math.max(80, maxY - minY)
      const pad = 72
      const k = Math.max(0.18, Math.min((bag.width - pad) / dx, (bag.height - pad) / dy, 1.8))
      bag.transform.k = k
      bag.transform.x = bag.width / 2 - ((minX + maxX) / 2) * k
      bag.transform.y = bag.height / 2 - ((minY + maxY) / 2) * k
      bag.fitted = true
    }

    const draw = () => {
      if (stopped) return
      const { width: w, height: h, dpr, transform: t } = bag
      if (w < 2 || h < 2) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const background = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.75)
      background.addColorStop(0, "#1c2118")
      background.addColorStop(1, "#10130e")
      ctx.fillStyle = background
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(t.x, t.y)
      ctx.scale(t.k, t.k)

      const viewLeft = -t.x / t.k
      const viewTop = -t.y / t.k
      const viewRight = (w - t.x) / t.k
      const viewBottom = (h - t.y) / t.k
      const span = Math.max(viewRight - viewLeft, viewBottom - viewTop)
      if (span < 2400) {
        const step = 56
        ctx.fillStyle = "rgba(232,226,210,0.045)"
        const size = 1.15 / t.k
        for (let x = Math.floor(viewLeft / step) * step; x < viewRight; x += step) {
          for (let y = Math.floor(viewTop / step) * step; y < viewBottom; y += step) {
            ctx.fillRect(x, y, size, size)
          }
        }
      }

      const hover = bag.hoverId
      const near = new Set<string>()
      if (hover) {
        near.add(hover)
        for (const id of bag.adj.get(hover) ?? []) near.add(id)
      }
      const q = bag.query.trim().toLowerCase()
      const matches = (node: GNode) =>
        !q ||
        node.title.toLowerCase().includes(q) ||
        node.folder.toLowerCase().includes(q) ||
        node.tags.some((tag) => tag.toLowerCase().includes(q))

      const paintLink = (link: GLink, hot: boolean) => {
        const a = asNode(link.source)
        const b = asNode(link.target)
        if (a.x == null || a.y == null || b.x == null || b.y == null) return
        const dim = (hover && !hot) || (q && (!matches(a) || !matches(b)))
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = hot ? "rgba(232,196,130,0.92)" : dim ? "rgba(214,206,186,0.04)" : "rgba(214,206,186,0.26)"
        ctx.lineWidth = (hot ? 1.7 : 1) / t.k
        ctx.setLineDash(link.kind === "note" ? [] : [3.2 / t.k, 3.4 / t.k])
        ctx.stroke()
        ctx.setLineDash([])
        const directed = link.kind === "note" && ((link.forward > 0) !== (link.back > 0))
        if (directed && (hot || t.k > 1.25) && !dim) {
          const from = link.forward > 0 ? a : b
          const to = link.forward > 0 ? b : a
          const px = (from.x ?? 0) + ((to.x ?? 0) - (from.x ?? 0)) * 0.68
          const py = (from.y ?? 0) + ((to.y ?? 0) - (from.y ?? 0)) * 0.68
          const angle = Math.atan2((to.y ?? 0) - (from.y ?? 0), (to.x ?? 0) - (from.x ?? 0))
          const size = 5 / t.k
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(px - Math.cos(angle - 0.5) * size, py - Math.sin(angle - 0.5) * size)
          ctx.moveTo(px, py)
          ctx.lineTo(px - Math.cos(angle + 0.5) * size, py - Math.sin(angle + 0.5) * size)
          ctx.stroke()
        }
      }

      for (const link of bag.links) {
        const a = asNode(link.source)
        const b = asNode(link.target)
        const hot = !!hover && near.has(a.id) && near.has(b.id)
        if (!hot) paintLink(link, false)
      }
      for (const link of bag.links) {
        const a = asNode(link.source)
        const b = asNode(link.target)
        const hot = !!hover && near.has(a.id) && near.has(b.id)
        if (hot) paintLink(link, true)
      }

      for (const node of bag.nodes) {
        if (node.x == null || node.y == null) continue
        const hot = !hover || near.has(node.id)
        const visible = matches(node)
        ctx.globalAlpha = !visible ? 0.07 : hot ? 1 : 0.08
        ctx.beginPath()
        if (node.kind === "tag") {
          ctx.moveTo(node.x, node.y - node.r)
          ctx.lineTo(node.x + node.r, node.y)
          ctx.lineTo(node.x, node.y + node.r)
          ctx.lineTo(node.x - node.r, node.y)
          ctx.closePath()
          ctx.fillStyle = node.color
          ctx.fill()
        } else if (node.kind === "ghost") {
          ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
          ctx.setLineDash([2.4 / t.k, 2.2 / t.k])
          ctx.lineWidth = 1.4 / t.k
          ctx.strokeStyle = node.color
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          ctx.arc(node.x, node.y, node.r + 3.5 / t.k, 0, Math.PI * 2)
          ctx.fillStyle = withAlpha(node.color, 0.16)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
          ctx.fillStyle = node.color
          ctx.fill()
          ctx.lineWidth = 1 / t.k
          ctx.strokeStyle = "rgba(255,250,240,0.38)"
          ctx.stroke()
          if (node.r >= 12 && t.k > 0.55 && ctx.globalAlpha > 0.4) {
            ctx.fillStyle = "#1a1e14"
            ctx.font = `600 ${Math.min(11, node.r * 0.72) / t.k}px ${bag.font}`
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(String(node.degree), node.x, node.y + 0.4 / t.k)
          }
        }
        if (node.id === bag.selectedId) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.r + 5.5 / t.k, 0, Math.PI * 2)
          ctx.lineWidth = 1.6 / t.k
          ctx.strokeStyle = "#f4efe2"
          ctx.setLineDash([])
          ctx.stroke()
        }
        if (node.pinned) {
          ctx.fillStyle = "#e0a45a"
          ctx.fillRect(node.x + node.r * 0.45, node.y - node.r - 3 / t.k, 2.4 / t.k, 2.4 / t.k)
        }
        ctx.globalAlpha = 1
      }

      for (const node of bag.nodes) {
        if (node.x == null || node.y == null) continue
        const neighbor = hover ? near.has(node.id) : false
        const selected = node.id === bag.selectedId || node.id === hover
        const show =
          bag.labels === "always" ||
          selected ||
          neighbor ||
          (bag.labels === "auto" && (t.k > 1.55 || node.degree >= 9 || (!!q && matches(node) && node.kind === "note")))
        if (!show || bag.labels === "never" && !selected) continue
        const alpha = !matches(node) ? 0.16 : hover && !near.has(node.id) ? 0.12 : 0.94
        const max = t.k < 0.65 ? 16 : t.k < 1.05 ? 26 : 42
        const text = node.title.length > max ? `${node.title.slice(0, max - 1)}…` : node.title
        ctx.globalAlpha = alpha
        ctx.font = `600 ${12 / t.k}px ${bag.font}`
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        ctx.lineWidth = 3.5 / t.k
        ctx.strokeStyle = "rgba(12,14,10,0.92)"
        ctx.strokeText(text, node.x, node.y + node.r + 4 / t.k)
        ctx.fillStyle = node.kind === "ghost" ? "#b7b2a4" : "#f3efe4"
        ctx.fillText(text, node.x, node.y + node.r + 4 / t.k)
        ctx.globalAlpha = 1
      }
      ctx.restore()

      if (bag.nodes.length) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const node of bag.nodes) {
          minX = Math.min(minX, node.x ?? 0)
          minY = Math.min(minY, node.y ?? 0)
          maxX = Math.max(maxX, node.x ?? 0)
          maxY = Math.max(maxY, node.y ?? 0)
        }
        const pad = 16
        minX -= pad
        minY -= pad
        maxX += pad
        maxY += pad
        const mw = 148
        const mh = 92
        const mx = w - mw - 14
        const my = h - mh - 16
        ctx.fillStyle = "rgba(16,19,14,0.78)"
        ctx.strokeStyle = "rgba(243,239,228,0.14)"
        ctx.lineWidth = 1
        ctx.beginPath()
        if (typeof ctx.roundRect === "function") ctx.roundRect(mx, my, mw, mh, 8)
        else ctx.rect(mx, my, mw, mh)
        ctx.fill()
        ctx.stroke()
        const sx = mw / Math.max(1, maxX - minX)
        const sy = mh / Math.max(1, maxY - minY)
        const scale = Math.min(sx, sy)
        const ox = mx + (mw - (maxX - minX) * scale) / 2
        const oy = my + (mh - (maxY - minY) * scale) / 2
        ctx.fillStyle = "rgba(224,196,138,0.8)"
        for (const node of bag.nodes) {
          ctx.fillRect(ox + ((node.x ?? 0) - minX) * scale, oy + ((node.y ?? 0) - minY) * scale, 2.2, 2.2)
        }
        const vx0 = ox + ((-t.x / t.k) - minX) * scale
        const vy0 = oy + ((-t.y / t.k) - minY) * scale
        const vx1 = ox + (((w - t.x) / t.k) - minX) * scale
        const vy1 = oy + (((h - t.y) / t.k) - minY) * scale
        ctx.save()
        ctx.beginPath()
        ctx.rect(mx + 3, my + 3, mw - 6, mh - 6)
        ctx.clip()
        ctx.strokeStyle = "rgba(243,239,228,0.7)"
        ctx.strokeRect(vx0, vy0, vx1 - vx0, vy1 - vy0)
        ctx.restore()
        bag.draw = draw
      }
    }
    bag.draw = draw

    measure()
    const graph = buildGraph(graphNotes, { ...graphSettings, focusId: graphFocus })
    setData(graph)
    const ignoreSaved = reseed.current
    reseed.current = false
    const saved = ignoreSaved ? {} : loadLayout()
    const folders = [...new Set(graph.nodes.map((node) => node.folder || node.kind))]
    const simNodes: GNode[] = graph.nodes.map((node) => {
      const folderIndex = Math.max(0, folders.indexOf(node.folder || node.kind))
      const angle = (folderIndex / Math.max(folders.length, 1)) * Math.PI * 2 - Math.PI / 2
      const ring = node.kind === "ghost" ? 300 : node.kind === "tag" ? 40 : 170
      const siblings = graph.nodes.filter((item) => item.folder === node.folder && item.kind === node.kind)
      const index = Math.max(0, siblings.findIndex((item) => item.id === node.id))
      const spread = (index / Math.max(siblings.length, 1)) * Math.PI * 2
      const radius = 28 + Math.sqrt(siblings.length) * 16
      const previous = saved[node.id]
      const seeded = previous && Number.isFinite(previous.x) && Number.isFinite(previous.y)
      const x = seeded ? previous.x : Math.cos(angle) * ring + Math.cos(spread) * radius
      const y = seeded ? previous.y : Math.sin(angle) * ring + Math.sin(spread) * radius
      return {
        ...node,
        r: radiusOf(node),
        x,
        y,
        pinned: !!previous?.pinned,
        fx: previous?.pinned ? previous.x : null,
        fy: previous?.pinned ? previous.y : null,
      }
    })
    const byId = new Map(simNodes.map((node) => [node.id, node]))
    const simLinks: GLink[] = graph.links
      .filter((link) => byId.has(link.source) && byId.has(link.target))
      .map((link) => ({ ...link }))
    const adj = new Map<string, Set<string>>()
    for (const link of graph.links) {
      const left = adj.get(link.source) ?? new Set<string>()
      left.add(link.target)
      adj.set(link.source, left)
      const right = adj.get(link.target) ?? new Set<string>()
      right.add(link.source)
      adj.set(link.target, right)
    }
    bag.nodes = simNodes
    bag.links = simLinks
    bag.adj = adj

    const linkForce = forceLink<GNode, GLink>(simLinks)
      .id((node) => node.id)
      .distance((link) => {
        const weight = Math.sqrt(link.forward + link.back)
        if (link.kind === "tag") return graphSettings.distance * 0.72
        if (link.kind === "ghost") return graphSettings.distance * 0.9
        return graphSettings.distance / Math.max(1, weight)
      })
      .strength((link) => (link.kind === "tag" ? 0.12 : link.kind === "ghost" ? 0.35 : 0.72))

    const sim = forceSimulation<GNode>(simNodes)
      .force("link", linkForce)
      .force("charge", forceManyBody<GNode>().strength(graphSettings.charge).distanceMax(560))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<GNode>().radius((node) => node.r + 11).iterations(2))
      .velocityDecay(0.42)
      .alphaDecay(0.028)
      .stop()
    bag.sim = sim

    const hadSaved = !ignoreSaved && simNodes.some((node) => saved[node.id])
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let fittedOnce = false
    sim.on("tick", () => {
      if (!fittedOnce && sim.alpha() < 0.22) {
        fittedOnce = true
        if (!hadSaved) fit()
      }
      draw()
    })
    sim.on("end", () => {
      saveLayout(bag.nodes)
      draw()
    })

    if (reduce) {
      for (let step = 0; step < 280; step += 1) sim.tick()
      if (!hadSaved) fit()
      saveLayout(bag.nodes)
      draw()
    } else {
      sim.alpha(hadSaved ? 0.22 : 1).restart()
    }

    const observer = new ResizeObserver(() => {
      measure()
      if (!bag.fitted) fit()
      draw()
    })
    observer.observe(host)
    bag.releasePins = () => {
      for (const node of bag.nodes) {
        node.fx = null
        node.fy = null
        node.pinned = false
      }
      sim.alpha(0.45).restart()
    }

    return () => {
      stopped = true
      saveLayout(bag.nodes)
      sim.stop()
      observer.disconnect()
      if (bag.sim === sim) bag.sim = null
    }
  }, [structureKey])

  useEffect(() => {
    if (skipCharge.current) {
      skipCharge.current = false
      return
    }
    const sim = world.current.sim
    if (!sim) return
    sim.force("charge", forceManyBody<GNode>().strength(settings.charge).distanceMax(560))
    const link = sim.force("link")
    if (link && "distance" in link) {
      ;(link as ReturnType<typeof forceLink<GNode, GLink>>).distance((item) => {
        const weight = Math.sqrt(item.forward + item.back)
        if (item.kind === "tag") return settings.distance * 0.72
        if (item.kind === "ghost") return settings.distance * 0.9
        return settings.distance / Math.max(1, weight)
      })
    }
    sim.alpha(0.28).restart()
  }, [settings.charge, settings.distance])

  useEffect(() => {
    world.current.draw()
  }, [query, settings.labels, selectedId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bag = world.current
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { dist: number; k: number } | null = null
    let drag: { kind: "node" | "pan"; id?: string; x: number; y: number; ox: number; oy: number; moved: boolean } | null = null

    const localPoint = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const hit = (point: { x: number; y: number }) => {
      const t = bag.transform
      const x = (point.x - t.x) / t.k
      const y = (point.y - t.y) / t.k
      let best: GNode | null = null
      let bestDistance = Infinity
      for (let index = bag.nodes.length - 1; index >= 0; index -= 1) {
        const node = bag.nodes[index]
        if (!node || node.x == null || node.y == null) continue
        const distance = Math.hypot(node.x - x, node.y - y)
        const pad = Math.max(node.r, 10 / t.k)
        if (distance <= pad + 2 / t.k && distance < bestDistance) {
          best = node
          bestDistance = distance
        }
      }
      return best
    }
    const zoomAt = (x: number, y: number, nextK: number) => {
      const t = bag.transform
      const k = Math.min(4, Math.max(0.12, nextK))
      const worldX = (x - t.x) / t.k
      const worldY = (y - t.y) / t.k
      t.k = k
      t.x = x - worldX * k
      t.y = y - worldY * k
      bag.draw()
    }

    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, localPoint(event))
      setMenu(null)
      if (pointers.size >= 2) {
        drag = null
        const [a, b] = [...pointers.values()]
        if (!a || !b) return
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: bag.transform.k }
        return
      }
      if (event.button !== 0) return
      const point = localPoint(event)
      const node = hit(point)
      canvas.setPointerCapture(event.pointerId)
      if (node) {
        drag = { kind: "node", id: node.id, x: event.clientX, y: event.clientY, ox: node.x ?? 0, oy: node.y ?? 0, moved: false }
        node.fx = node.x
        node.fy = node.y
        bag.sim?.alphaTarget(0.18).restart()
        return
      }
      drag = { kind: "pan", x: event.clientX, y: event.clientY, ox: bag.transform.x, oy: bag.transform.y, moved: false }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, localPoint(event))
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()]
        if (!a || !b) return
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        zoomAt(mid.x, mid.y, pinch.k * (dist / Math.max(pinch.dist, 1)))
        return
      }
      const point = localPoint(event)
      if (!drag) {
        const node = hit(point)
        const next = node?.id ?? null
        if (next !== bag.hoverId) {
          bag.hoverId = next
          canvas.style.cursor = node ? "pointer" : "grab"
          bag.draw()
        }
        return
      }
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (Math.hypot(dx, dy) > 3) drag.moved = true
      if (drag.kind === "pan") {
        bag.transform.x = drag.ox + dx
        bag.transform.y = drag.oy + dy
        canvas.style.cursor = "grabbing"
        bag.draw()
        return
      }
      const node = bag.nodes.find((item) => item.id === drag?.id)
      if (!node) return
      const t = bag.transform
      node.fx = drag.ox + dx / t.k
      node.fy = drag.oy + dy / t.k
      node.x = node.fx
      node.y = node.fy
      node.pinned = true
      bag.draw()
    }
    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinch = null
      if (!drag) return
      const finished = drag
      drag = null
      bag.sim?.alphaTarget(0)
      if (finished.kind === "node") {
        const node = bag.nodes.find((item) => item.id === finished.id)
        if (node && !finished.moved) {
          node.fx = null
          node.fy = null
          node.pinned = false
          setSelectedId(node.id)
        } else if (node) {
          saveLayout(bag.nodes)
        }
      } else if (!finished.moved) {
        setSelectedId(null)
      }
      canvas.style.cursor = "grab"
      bag.draw()
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const point = localPoint(event)
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoomAt(point.x, point.y, bag.transform.k * Math.exp(-delta * 0.00115))
    }
    const onDouble = (event: MouseEvent) => {
      const node = hit(localPoint(event))
      if (!node) return
      if (node.kind === "note" && node.noteId) openRef.current(node.noteId)
      if (node.kind === "ghost") createRef.current(node.title)
    }
    const onContext = (event: MouseEvent) => {
      event.preventDefault()
      const node = hit(localPoint(event))
      if (!node) {
        setMenu(null)
        return
      }
      setSelectedId(node.id)
      setMenu({ x: event.clientX, y: event.clientY, id: node.id })
    }

    canvas.addEventListener("pointerdown", onPointerDown)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerup", onPointerUp)
    canvas.addEventListener("pointercancel", onPointerUp)
    canvas.addEventListener("wheel", onWheel, { passive: false })
    canvas.addEventListener("dblclick", onDouble)
    canvas.addEventListener("contextmenu", onContext)
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", onPointerUp)
      canvas.removeEventListener("pointercancel", onPointerUp)
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("dblclick", onDouble)
      canvas.removeEventListener("contextmenu", onContext)
    }
  }, [])

  const selected = data.nodes.find((node) => node.id === selectedId) ?? null
  const focus = notes.find((note) => note.id === focusId) ?? null
  const folders = [...new Set(notes.map((note) => note.folder))]
  const noteCount = data.nodes.filter((node) => node.kind === "note").length
  const orphanCount = data.nodes.filter((node) => node.kind === "note" && node.realDegree === 0).length
  const ghostCount = data.nodes.filter((node) => node.kind === "ghost").length
  const tagList = useMemo(() => {
    const counts = new Map<string, string>()
    for (const node of data.nodes) {
      if (node.kind !== "note") continue
      for (const tag of node.tags) counts.set(tag.toLowerCase(), tag)
    }
    return [...counts.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }, [data.nodes])

  const zoomBy = (factor: number) => {
    const bag = world.current
    const x = bag.width / 2
    const y = bag.height / 2
    const k = Math.min(4, Math.max(0.12, bag.transform.k * factor))
    const worldX = (x - bag.transform.x) / bag.transform.k
    const worldY = (y - bag.transform.y) / bag.transform.k
    bag.transform.k = k
    bag.transform.x = x - worldX * k
    bag.transform.y = y - worldY * k
    bag.draw()
  }

  const fitNow = () => {
    const bag = world.current
    if (!bag.nodes.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of bag.nodes) {
      minX = Math.min(minX, (node.x ?? 0) - node.r)
      minY = Math.min(minY, (node.y ?? 0) - node.r)
      maxX = Math.max(maxX, (node.x ?? 0) + node.r)
      maxY = Math.max(maxY, (node.y ?? 0) + node.r)
    }
    const k = Math.max(0.18, Math.min((bag.width - 72) / Math.max(80, maxX - minX), (bag.height - 72) / Math.max(80, maxY - minY), 1.8))
    bag.transform.k = k
    bag.transform.x = bag.width / 2 - ((minX + maxX) / 2) * k
    bag.transform.y = bag.height / 2 - ((minY + maxY) / 2) * k
    bag.draw()
  }

  const relayout = () => {
    reseed.current = true
    localStorage.removeItem(LAYOUT_KEY)
    setNonce((value) => value + 1)
  }

  const releasePins = () => {
    world.current.releasePins()
  }

  const exportPng = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement("a")
    link.href = canvas.toDataURL("image/png")
    link.download = "nit-graph.png"
    link.click()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const bag = world.current
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return
    event.preventDefault()
    if (event.key === "Enter") {
      const node = bag.nodes.find((item) => item.id === bag.selectedId)
      if (node?.kind === "note" && node.noteId) onOpenNote(node.noteId)
      if (node?.kind === "ghost") onCreateNote(node.title)
      return
    }
    const current = bag.nodes.find((item) => item.id === bag.selectedId) ?? bag.nodes.find((item) => item.kind === "note")
    if (!current) return
    let best: GNode | null = null
    let bestScore = Infinity
    for (const node of bag.nodes) {
      if (node.id === current.id || node.x == null || node.y == null || current.x == null || current.y == null) continue
      const dx = node.x - current.x
      const dy = node.y - current.y
      if (event.key === "ArrowLeft" && dx >= -4) continue
      if (event.key === "ArrowRight" && dx <= 4) continue
      if (event.key === "ArrowUp" && dy >= -4) continue
      if (event.key === "ArrowDown" && dy <= 4) continue
      const primary = event.key === "ArrowLeft" || event.key === "ArrowRight" ? Math.abs(dx) : Math.abs(dy)
      const secondary = event.key === "ArrowLeft" || event.key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx)
      if (secondary > primary * 1.35) continue
      const score = primary + secondary * 0.55
      if (score < bestScore) {
        best = node
        bestScore = score
      }
    }
    if (!best) return
    setSelectedId(best.id)
    const sx = (best.x ?? 0) * bag.transform.k + bag.transform.x
    const sy = (best.y ?? 0) * bag.transform.k + bag.transform.y
    if (sx < 48 || sy < 80 || sx > bag.width - 48 || sy > bag.height - 48) {
      bag.transform.x = bag.width / 2 - (best.x ?? 0) * bag.transform.k
      bag.transform.y = bag.height / 2 - (best.y ?? 0) * bag.transform.k
    }
    bag.draw()
  }

  const patch = (partial: Partial<GraphSettings>) => onSettings({ ...settings, ...partial })
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const menuNode = menu ? data.nodes.find((node) => node.id === menu.id) : null

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#10130e] outline-none"
      aria-label="Граф связей заметок"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5">
            <div className="flex rounded-lg bg-[#1b1f18]/90 p-0.5 ring-1 ring-white/10 backdrop-blur">
              <Button size="sm" variant={settings.mode === "global" ? "default" : "ghost"} onClick={() => patch({ mode: "global" })}>
                Весь граф
              </Button>
              <Button
                size="sm"
                variant={settings.mode === "local" ? "default" : "ghost"}
                onClick={() => patch({ mode: "local" })}
                disabled={!focus}
              >
                Вокруг заметки
              </Button>
            </div>
            {settings.mode === "local" && (
              <div className="flex items-center gap-1 rounded-lg bg-[#1b1f18]/90 px-1.5 py-1 ring-1 ring-white/10 backdrop-blur">
                <span className="px-1 text-xs text-muted-foreground">Глубина</span>
                {[1, 2, 3].map((depth) => (
                  <Button key={depth} size="icon-sm" variant={settings.depth === depth ? "secondary" : "ghost"} onClick={() => patch({ depth })}>
                    {depth}
                  </Button>
                ))}
              </div>
            )}
            {settings.mode === "local" && focus && (
              <div className="max-w-56 truncate rounded-lg bg-[#1b1f18]/90 px-2.5 py-1.5 text-xs text-[#f3efe4] ring-1 ring-white/10">
                {focus.title}
              </div>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-1">
            <Button size="icon-sm" variant="outline" className="bg-[#1b1f18]/90" onClick={() => zoomBy(1.15)} aria-label="Приблизить">
              <Plus />
            </Button>
            <Button size="icon-sm" variant="outline" className="bg-[#1b1f18]/90" onClick={() => zoomBy(1 / 1.15)} aria-label="Отдалить">
              <Shrink />
            </Button>
            <Button size="icon-sm" variant="outline" className="bg-[#1b1f18]/90" onClick={fitNow} aria-label="Вписать граф">
              <LocateFixed />
            </Button>
            <Popover>
              <PopoverTrigger
                render={<Button size="icon-sm" variant="outline" className="bg-[#1b1f18]/90" aria-label="Настройки графа" />}
              >
                <Settings2 />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span>Сироты</span>
                  <Switch checked={settings.showOrphans} onCheckedChange={(checked) => patch({ showOrphans: checked })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Призраки</span>
                  <Switch checked={settings.showGhosts} onCheckedChange={(checked) => patch({ showGhosts: checked })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Теги как узлы</span>
                  <Switch checked={settings.showTagNodes} onCheckedChange={(checked) => patch({ showTagNodes: checked })} />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Подписи</div>
                  <div className="flex gap-1">
                    {(
                      [
                        ["auto", "Сами"],
                        ["always", "Все"],
                        ["never", "Нет"],
                      ] as const
                    ).map(([value, label]) => (
                      <Button key={value} size="sm" variant={settings.labels === value ? "secondary" : "ghost"} onClick={() => patch({ labels: value })}>
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Цвет</div>
                  <div className="flex gap-1">
                    <Button size="sm" variant={settings.colorBy === "folder" ? "secondary" : "ghost"} onClick={() => patch({ colorBy: "folder" })}>
                      Папки
                    </Button>
                    <Button size="sm" variant={settings.colorBy === "tag" ? "secondary" : "ghost"} onClick={() => patch({ colorBy: "tag" })}>
                      Теги
                    </Button>
                  </div>
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Отталкивание</span>
                  <Slider
                    min={40}
                    max={520}
                    step={10}
                    value={[Math.abs(settings.charge)]}
                    onValueChange={(value) => {
                      const next = Array.isArray(value) ? value[0] : value
                      if (typeof next === "number") patch({ charge: -next })
                    }}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Длина связей</span>
                  <Slider
                    min={36}
                    max={180}
                    step={2}
                    value={[settings.distance]}
                    onValueChange={(value) => {
                      const next = Array.isArray(value) ? value[0] : value
                      if (typeof next === "number") patch({ distance: next })
                    }}
                  />
                </label>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Папки</div>
                  <div className="flex flex-wrap gap-1">
                    {folders.map((folder) => {
                      const active = settings.folders.includes(folder)
                      return (
                        <button
                          key={folder || "none"}
                          type="button"
                          onClick={() => patch({ folders: toggleIn(settings.folders, folder) })}
                          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${active ? "bg-white/15 ring-white/30" : "ring-white/10"}`}
                        >
                          <span className="mr-1 inline-block size-1.5 rounded-full" style={{ background: colorForFolder(folder) }} />
                          {folderLabel(folder)}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {tagList.length > 0 && (
                  <div className="max-h-28 space-y-1.5 overflow-auto">
                    <div className="text-xs text-muted-foreground">Теги</div>
                    <div className="flex flex-wrap gap-1">
                      {tagList.map((tag) => {
                        const active = settings.tags.some((item) => item.toLowerCase() === tag.toLowerCase())
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => patch({ tags: toggleIn(settings.tags, tag) })}
                            className={`rounded-full px-2 py-0.5 text-xs ring-1 ${active ? "bg-white/15 ring-white/30" : "ring-white/10"}`}
                          >
                            #{tag}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={relayout}>
                    <RotateCcw />
                    Собрать заново
                  </Button>
                  <Button size="sm" variant="outline" onClick={releasePins}>
                    Отпустить узлы
                  </Button>
                  <Button size="sm" variant="outline" onClick={exportPng}>
                    <Download />
                    Картинка
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg bg-[#1b1f18]/85 px-2.5 py-1.5 text-xs text-[#d9d3c5] ring-1 ring-white/10 backdrop-blur">
            <span>{noteCount} заметок</span>
            <span className="text-white/25">·</span>
            <span>{data.links.length} связей</span>
            <span className="text-white/25">·</span>
            <span>{orphanCount} сирот</span>
            <span className="text-white/25">·</span>
            <span>{ghostCount} призраков</span>
          </div>
          {(settings.folders.length > 0 || settings.tags.length > 0) && (
            <button type="button" className="pointer-events-auto rounded-lg bg-[#1b1f18]/90 px-2 py-1 text-xs ring-1 ring-white/10" onClick={() => patch({ folders: [], tags: [] })}>
              Сбросить фильтр
            </button>
          )}
        </div>
      </div>

      {selected && (
        <aside className="absolute top-16 right-3 z-20 w-[min(20rem,calc(100%-1.5rem))] rounded-xl bg-[#1c2118]/95 p-3 text-sm shadow-2xl ring-1 ring-white/10 backdrop-blur sm:top-14">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-serif text-base leading-tight text-[#f6f1e6]">{selected.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selected.kind === "note" && (folderLabel(selected.folder) || "Заметка")}
                {selected.kind === "ghost" && "Несозданная заметка"}
                {selected.kind === "tag" && "Тег"}
                {" · "}
                {selected.degree} связей
              </div>
            </div>
            <button type="button" className="text-muted-foreground" onClick={() => setSelectedId(null)} aria-label="Закрыть карточку">
              ×
            </button>
          </div>
          {selected.excerpt && <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-[#ddd6c6]">{selected.excerpt}</p>}
          {selected.tags.length > 0 && selected.kind === "note" && (
            <div className="mt-2 flex flex-wrap gap-1">
              {selected.tags.map((tag) => (
                <button key={tag} type="button" className="rounded-full bg-white/5 px-2 py-0.5 text-xs" onClick={() => patch({ tags: [tag], mode: "global" })}>
                  #{tag}
                </button>
              ))}
            </div>
          )}
          {selected.referrers.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Ссылаются: {selected.referrers.slice(0, 4).join(", ")}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {selected.kind === "note" && selected.noteId && (
              <>
                <Button size="sm" onClick={() => onOpenNote(selected.noteId!)}>
                  Открыть
                </Button>
                <Button size="sm" variant="outline" onClick={() => onFocusNote(selected.noteId!)}>
                  <Crosshair />
                  Вокруг
                </Button>
              </>
            )}
            {selected.kind === "ghost" && (
              <Button size="sm" onClick={() => onCreateNote(selected.title)}>
                Создать заметку
              </Button>
            )}
            {selected.kind === "tag" && (
              <Button size="sm" variant="outline" onClick={() => patch({ tags: [selected.title.replace(/^#/, "")], mode: "global" })}>
                Фильтр по тегу
              </Button>
            )}
          </div>
        </aside>
      )}

      {data.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="pointer-events-auto max-w-sm rounded-xl bg-[#1c2118]/95 p-4 text-center ring-1 ring-white/10">
            <div className="font-serif text-lg">Граф пуст</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {settings.mode === "local" && !focus
                ? "Откройте заметку, чтобы увидеть её окрестность."
                : "Фильтр спрятал все узлы или в хранилище ещё нет заметок."}
            </p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => patch({ mode: "global", folders: [], tags: [], showOrphans: true })}>
              Показать всё
            </Button>
          </div>
        </div>
      )}

      {hint && data.nodes.length > 0 && (
        <div className="pointer-events-auto absolute top-16 left-1/2 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-[#1c2118]/95 px-3 py-2 text-center text-xs text-[#ddd6c6] ring-1 ring-white/10">
          Тяните узлы, крутите колесо, наведитесь, чтобы подсветить соседей. Двойной щелчок открывает заметку.
          <button
            type="button"
            className="ml-2 underline"
            onClick={dismissHint}
          >
            Понятно
          </button>
        </div>
      )}

      {menu && menuNode && (
        <div className="fixed z-40 min-w-44 rounded-lg bg-popover p-1 text-sm shadow-xl ring-1 ring-foreground/10" style={{ left: menu.x, top: menu.y }}>
          {menuNode.kind === "note" && menuNode.noteId && (
            <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onOpenNote(menuNode.noteId!); setMenu(null) }}>
              Открыть
            </button>
          )}
          {menuNode.kind === "note" && menuNode.noteId && (
            <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onFocusNote(menuNode.noteId!); setMenu(null) }}>
              Окрестность
            </button>
          )}
          {menuNode.kind === "ghost" && (
            <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onCreateNote(menuNode.title); setMenu(null) }}>
              Создать заметку
            </button>
          )}
          <button
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => {
              const node = world.current.nodes.find((item) => item.id === menuNode.id)
              if (node) {
                node.fx = null
                node.fy = null
                node.pinned = false
                world.current.sim?.alpha(0.3).restart()
              }
              setMenu(null)
            }}
          >
            Отпустить узел
          </button>
        </div>
      )}
    </div>
  )
}
