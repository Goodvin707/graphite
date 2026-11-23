"use client"

import type { Note } from "@/lib/model"
import { toMarkdownSource } from "@/lib/model"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"

type MarkdownViewProps = {
  content: string
  notes: Note[]
  onOpenWiki: (title: string, missing: boolean) => void
  onOpenTag: (tag: string) => void
}

function safeHttp(href: string | undefined) {
  return !!href && /^(https?:|mailto:)/i.test(href)
}

export function MarkdownView({ content, notes, onOpenWiki, onOpenTag }: MarkdownViewProps) {
  const titles = new Set(notes.map((note) => note.title.trim().toLowerCase()))
  const source = toMarkdownSource(content, titles)

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("wiki:") || url.startsWith("tag:") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("wiki:")) {
              const missing = href.includes("?missing=1")
              const raw = href.slice(5).replace(/\?missing=1$/, "")
              let title = raw
              try {
                title = decodeURIComponent(raw)
              } catch {
                title = raw
              }
              return (
                <button
                  type="button"
                  className={missing ? "wiki wiki-missing" : "wiki"}
                  onClick={() => onOpenWiki(title, missing)}
                >
                  {children}
                </button>
              )
            }
            if (href?.startsWith("tag:")) {
              const raw = href.slice(4)
              let tag = raw
              try {
                tag = decodeURIComponent(raw)
              } catch {
                tag = raw
              }
              return (
                <button type="button" className="tag-pill" onClick={() => onOpenTag(tag)}>
                  {children}
                </button>
              )
            }
            if (!safeHttp(href)) return <span>{children}</span>
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
          img: ({ src, alt }) => {
            if (typeof src !== "string" || !/^https:\/\//i.test(src)) return null
            // Notes may point at any https image; the optimizer has no remote allowlist for them.
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={alt ?? ""} referrerPolicy="no-referrer" />
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
