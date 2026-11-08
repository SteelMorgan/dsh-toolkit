// Entry point for: node --import ./loader.mjs ...
// Registers the source hook that raises dsh-TUI's rendered-row cap.
import { register } from 'node:module'

register('./hooks.mjs', import.meta.url)
