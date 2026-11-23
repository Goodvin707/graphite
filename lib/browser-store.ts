import { createEmptyVault, createSampleVault } from "./sample-vault"
import {
  DEFAULT_GRAPH_SETTINGS,
  loadGraphSettings,
  loadVault,
  saveGraphSettings,
  saveVault,
  vaultExists,
  type GraphSettings,
  type Vault,
} from "./model"

type Listener = () => void

const vaultListeners = new Set<Listener>()
const settingsListeners = new Set<Listener>()
const hintListeners = new Set<Listener>()
const introListeners = new Set<Listener>()

let vaultMemory: Vault | null = null
let settingsMemory: GraphSettings | null = null
let introMemory: boolean | null = null

function listen(set: Set<Listener>, listener: Listener) {
  set.add(listener)
  return () => set.delete(listener)
}

function emit(set: Set<Listener>) {
  for (const listener of set) listener()
}

export function subscribeVault(listener: Listener) {
  return listen(vaultListeners, listener)
}

export function getVault() {
  if (typeof window === "undefined") return null
  if (!vaultMemory) {
    const stored = vaultExists() ? loadVault() : null
    vaultMemory = stored && (stored.notes.length > 0 || stored.name) ? stored : createSampleVault()
  }
  return vaultMemory
}

export function getServerVault(): Vault | null {
  return null
}

export function commitVault(next: Vault) {
  vaultMemory = next
  saveVault(next)
  emit(vaultListeners)
}

export function subscribeSettings(listener: Listener) {
  return listen(settingsListeners, listener)
}

export function getSettings() {
  if (typeof window === "undefined") return DEFAULT_GRAPH_SETTINGS
  settingsMemory ??= loadGraphSettings()
  return settingsMemory
}

export function getServerSettings() {
  return DEFAULT_GRAPH_SETTINGS
}

export function commitSettings(next: GraphSettings) {
  settingsMemory = next
  saveGraphSettings(next)
  emit(settingsListeners)
}

export function subscribeIntro(listener: Listener) {
  return listen(introListeners, listener)
}

export function getIntroDismissed() {
  if (typeof window === "undefined") return true
  introMemory ??= localStorage.getItem("nit-intro-dismissed") === "1"
  return introMemory
}

export function dismissIntro() {
  introMemory = true
  localStorage.setItem("nit-intro-dismissed", "1")
  emit(introListeners)
}

export function subscribeHint(listener: Listener) {
  return listen(hintListeners, listener)
}

export function getHintVisible() {
  return localStorage.getItem("nit-graph-hint") !== "1"
}

export function dismissHint() {
  localStorage.setItem("nit-graph-hint", "1")
  emit(hintListeners)
}

export function freshSample() {
  return createSampleVault()
}

export function freshEmpty() {
  return createEmptyVault()
}
