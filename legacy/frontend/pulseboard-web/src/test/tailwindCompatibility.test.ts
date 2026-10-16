import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { describe, expect, it } from 'vitest'

describe('Tailwind workbench compatibility', () => {
  it('compiles the migrated controls with their v3 appearance values', async () => {
    const input = path.resolve('src/tailwind.input.css')
    const result = await postcss([tailwindcss()]).process(readFileSync(input, 'utf8'), { from: input })
    const rules = new Map<string, Record<string, string>>()
    result.root.walkRules(rule => {
      const declarations: Record<string, string> = {}
      rule.each(node => {
        if (node.type === 'decl') declarations[node.prop] = node.value
      })
      rules.set(rule.selector, { ...rules.get(rule.selector), ...declarations })
    })
    const theme = rules.get(':root, :host')!
    expect(theme['--blur-xs']).toBe('4px')
    expect(theme['--radius-sm']).toBe('0.25rem')
    expect(theme['--color-gray-200']).toBe('#e5e7eb')
    expect(theme['--color-primary-500']).toBe('#3b82f6')
    expect(rules.get('.backdrop-blur-xs')?.['--tw-backdrop-blur']).toBe('blur(var(--blur-xs))')
    expect(rules.get('.rounded-sm')?.['border-radius']).toBe('var(--radius-sm)')
    expect(rules.get('.shrink-0')?.['flex-shrink']).toBe('0')
    expect(rules.get('.focus\\:ring-2:focus')?.['--tw-ring-shadow']).toContain('2px')
    expect(result.css).toMatch(/\.focus\\:outline-hidden:focus[\s\S]*?@media \(forced-colors: active\)[\s\S]*?outline: 2px solid transparent/)
    expect(result.css).toContain('to right in srgb')
    expect(result.css).toContain('to bottom right in srgb')
    expect(rules.get('.space-y-4 > :not([hidden]) ~ :not([hidden])')?.['margin-top']).toBe('1rem')
    expect(rules.get('input::placeholder, textarea::placeholder')?.color).toBe('var(--color-gray-400)')
    expect(rules.get('button, [role="button"]')?.cursor).toBe('pointer')
  })
})
