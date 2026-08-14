import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bundledSkills, securityAuditSkill, reframeSkill } from '../src/skills.ts'

test('bundled skills have valid registration shapes', () => {
  assert.equal(bundledSkills.length, 2)
  for (const skill of bundledSkills) {
    assert.match(skill.name, /^[a-z0-9-]+$/)
    assert.equal(skill.source, 'bundled')
    assert.ok(skill.description.length > 10, `${skill.name} description`)
    assert.ok(skill.content.length > 200, `${skill.name} content`)
  }
  assert.deepEqual(bundledSkills.map((s) => s.name).sort(), ['wolf-reframe', 'wolf-security-audit'])
})

test('security-audit skill covers the four layers and buglog wiring', () => {
  const content = securityAuditSkill.content
  for (const layer of ['Dependencies', 'Secrets', 'Injection surfaces', 'Authorization']) {
    assert.ok(content.includes(layer), `missing layer: ${layer}`)
  }
  assert.ok(content.includes('wolf_bug'), 'wires findings into the buglog')
  assert.ok(content.includes('severity'), 'severity-ranked report')
})

test('reframe skill has the 13-framework KB and anti-generic mandate', () => {
  const content = reframeSkill.content
  const frameworks = ['shadcn/ui', 'Aceternity', 'Magic UI', 'DaisyUI', 'HeroUI', 'Chakra', 'Flowbite', 'Preline', 'Park UI', 'Origin UI', 'Headless UI', 'Cult UI', 'Astryx']
  for (const f of frameworks) {
    assert.ok(content.includes(f), `missing framework: ${f}`)
  }
  assert.ok(content.includes('Distinctiveness'), 'anti-generic mandate')
  assert.ok(content.includes('AI-generated'), 'failure state defined')
})
