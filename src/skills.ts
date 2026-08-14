/**
 * Bundled skills for dsh-openwolf: `wolf-security-audit` and `wolf-reframe`,
 * registered into the harness skill registry (`ctx.skills`). Independent
 * implementation of the reference project's bundled slash commands — same
 * purpose, original content.
 *
 * @module dsh-openwolf/skills
 */

import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/** `wolf-security-audit`: layered security audit ending in a buglog-wired report. */
export const securityAuditSkill: SkillRegistration = {
  name: 'wolf-security-audit',
  source: 'bundled',
  description:
    'Layered security audit of the workspace — dependencies, secrets, injection surfaces, and authorization — ending in a severity-ranked report wired into .wolf/buglog.json.',
  whenToUse:
    'Run before a release, after adding dependencies, or when reviewing code that handles untrusted input, credentials, or authorization.',
  content: `# Security Audit (dsh-openwolf)

Audit the current workspace in four layers. For each layer, collect concrete
findings with file:line references; finish with a severity-ranked report and
wire every confirmed bug into \`.wolf/buglog.json\` with \`wolf_bug\`.

## Layer 1 — Dependencies

- Enumerate dependency manifests (\`package.json\`, \`requirements.txt\`,
  \`go.mod\`, \`Cargo.toml\`, \`Gemfile\`, \`pom.xml\`, ...) and flag:
  - known-vulnerable or unmaintained packages (check the ecosystem advisory
    database when reachable);
  - very old pinned versions with security fixes available;
  - suspiciously named or typo-squatted packages (recent publish date, few
    downloads, lookalike name);
  - scripts that run at install time (\`postinstall\`, \`prepare\`, \`setup.py
    build\`, \`build.rs\`) in third-party packages — inspect them.

## Layer 2 — Secrets

- Search for secret-bearing material in tracked files (NOT in \`.git\`):
  - API keys, tokens, passwords, connection strings, private keys;
  - \`.env\` / \`.env.*\` files and their templates (\`.env.example\` is fine to
    index, but flag any real values);
  - hardcoded credentials in code (e.g. \`password = "..."\`, \`Bearer <token>\`).
- Verify git history is clean of committed secrets (\`git log -S\` style scan);
  if a secret was committed, recommend rotation, not just removal.

## Layer 3 — Injection surfaces

- Untrusted input paths: request bodies, query params, headers, file uploads,
  CLI args, \`eval\`/template-rendering call sites, SQL/query string
  construction, shell command building, HTML rendering.
- Flag: raw SQL interpolation, \`child_process\` with concatenated shell
  strings, \`eval\`/similar on unsanitized input, \`dangerouslySetInnerHTML\`-
  style sinks with untrusted data, path traversal (user input joined into
  file paths without containment).

## Layer 4 — Authorization

- Identify auth boundaries: login/session logic, middleware, role/scope
  checks, object-level access decisions.
- Flag: missing checks on mutating endpoints, direct object access without
  ownership verification, overly permissive defaults (world-readable files,
  wide CORS, wildcard roles), missing rate limiting on sensitive endpoints.

## Report

Produce a severity-ranked report:

\`\`\`markdown
# Security audit — <workspace>
- CRITICAL: <finding> (<file:line>)
- HIGH: ...
- MEDIUM: ...
- LOW: ...
- ✓ checks passed: <list>
\`\`\`

For every CRITICAL/HIGH finding you can confirm, call \`wolf_bug\` with the
error/symptom and the fix to keep it in the buglog (prevents rediscovery).
`,
}

/** Independent 13-framework UI knowledge base for the reframe skill. */
const FRAMEWORK_KB: Array<{ name: string; tagline: string; bestFor: string }> = [
  { name: 'shadcn/ui', tagline: 'copy-paste headless components on Radix, styled with Tailwind', bestFor: 'teams that want full control of markup and styling, no lock-in' },
  { name: 'Aceternity UI', tagline: 'glamorous animated components and sections for marketing sites', bestFor: 'showcase landing pages with motion' },
  { name: 'Magic UI', tagline: 'animated, shadcn-compatible building blocks', bestFor: 'adding polish to a shadcn base' },
  { name: 'DaisyUI', tagline: 'Tailwind class-driven component classes, zero JS', bestFor: 'fast prototypes and CRUD-heavy apps' },
  { name: 'HeroUI', tagline: 'React components (ex NextUI) with Tailwind and framer-motion', bestFor: 'React apps needing batteries-included styling' },
  { name: 'Chakra UI', tagline: 'accessible React primitives with a theme system', bestFor: 'design-system-led React applications' },
  { name: 'Flowbite', tagline: 'Tailwind component library mirroring Tailwind UI look', bestFor: 'Tailwind shops wanting quick, conventional UI' },
  { name: 'Preline UI', tagline: 'Tailwind + Alpine/JS interactive components', bestFor: 'marketing sites and admin dashboards' },
  { name: 'Park UI', tagline: 'headless components with a themeable style layer', bestFor: 'brand-consistent systems over multiple targets' },
  { name: 'Origin UI', tagline: 'shadcn-style components for React with refined motion', bestFor: 'premium-feel React dashboards' },
  { name: 'Headless UI', tagline: 'unstyled accessible primitives (Tailwind Labs)', bestFor: 'fully custom design with guaranteed a11y behavior' },
  { name: 'Cult UI', tagline: 'experimental animated components for shadcn/React', bestFor: 'distinctive, characterful interfaces' },
  { name: 'Astryx', tagline: 'open-source animated Tailwind components', bestFor: 'flashy section components for landing pages' },
]

/** `wolf-reframe`: UI framework migration/audit/fix with an anti-generic mandate. */
export const reframeSkill: SkillRegistration = {
  name: 'wolf-reframe',
  source: 'bundled',
  description:
    'Design brain for UI work: pick or migrate a UI framework from a 13-framework knowledge base, or audit and fix existing UI against an anti-generic design mandate.',
  whenToUse:
    'Choosing a UI stack, migrating between frameworks, or auditing an interface that looks generic/AI-generated.',
  content: `# Reframe (dsh-openwolf)

## Modes

- \`reframe migrate\` — pick a target framework for the workspace and produce a
  migration plan: mapping of components, styling approach, and a risk list.
- \`reframe audit\` — audit the existing UI against the anti-generic mandate
  below; return a severity-ranked list with concrete changes.
- \`reframe fix\` — apply the audit's fixes in safe increments, verifying each
  step.

## Framework knowledge base

${FRAMEWORK_KB.map((f) => `- **${f.name}** — ${f.tagline}. Best for: ${f.bestFor}.`).join('\n')}

## Anti-generic design mandate

Distinctiveness is an acceptance criterion. The recognizable
AI-generated look is a failure state. In every audit, check for:

- **Uniform card grids** with identical padding, radius, and shadows;
- **The default gradient** (indigo→purple→pink) used as a hero background;
- **Generic hero copy** ("Unlock the power of...", "Supercharge your...");
- **Emoji bullet lists** and identical feature-card icon sets;
- **Default fonts** with no type hierarchy or personality;
- **Stock SVG illustrations** pasted from the same corpus.

For each failure, propose a concrete, brand-specific alternative (a color
token from the product palette, a type scale, a layout break, a custom
illustration direction) rather than a generic tweak.
`,
}

/** All bundled skills, registered when the harness skill registry exists. */
export const bundledSkills: SkillRegistration[] = [securityAuditSkill, reframeSkill]
