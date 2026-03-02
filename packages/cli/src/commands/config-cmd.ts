import { Command } from 'commander'
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { getConfigPath } from '../config.js'

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

function loadExisting(): Record<string, string> {
  const configPath = getConfigPath()
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch { /* ignore */ }
  }
  return {}
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.slice(0, 8) + '...' + value.slice(-4)
}

export function registerConfigCommand(program: Command): void {
  // agentpm login
  program
    .command('login')
    .description('Login with your API Key (get it from Web UI → Settings → API Keys)')
    .action(async () => {
      const configPath = getConfigPath()
      const existing = loadExisting()

      console.error('AgentPM CLI Login')
      console.error('─'.repeat(40))

      const config: Record<string, string> = { ...existing }

      const apiUrl = await prompt('API URL', existing.apiUrl || undefined)
      if (apiUrl) config.apiUrl = apiUrl

      console.error('\nPaste your API Key from Web UI → Settings → API Keys:')
      const apiKey = await prompt('API Key', existing.apiKey ? maskSecret(existing.apiKey) : undefined)
      if (apiKey && !apiKey.includes('...')) {
        config.apiKey = apiKey
      }

      const defaultSpaceId = await prompt('Default Space ID (optional, press Enter to skip)', existing.defaultSpaceId)
      if (defaultSpaceId) config.defaultSpaceId = defaultSpaceId

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
      console.error(`\n✓ Config saved to ${configPath}`)

      if (config.apiKey || existing.apiKey) {
        console.error('✓ Run `agentpm space list` to verify your setup')
      }
    })

  // agentpm config — advanced config management
  const cfg = program.command('config').description('CLI configuration')

  cfg
    .command('show')
    .description('Show current config (secrets masked)')
    .action(() => {
      const configPath = getConfigPath()

      if (!existsSync(configPath)) {
        console.error(`No config file at ${configPath}`)
        console.error('Run: agentpm login')
        process.exit(1)
      }

      const content = JSON.parse(readFileSync(configPath, 'utf-8'))
      const masked = { ...content }
      if (masked.apiKey) masked.apiKey = maskSecret(masked.apiKey)
      console.log(JSON.stringify(masked, null, 2))
    })

  cfg
    .command('path')
    .description('Print config file path')
    .action(() => {
      console.log(getConfigPath())
    })

  cfg
    .command('reset')
    .description('Delete config file')
    .action(() => {
      const configPath = getConfigPath()
      if (existsSync(configPath)) {
        unlinkSync(configPath)
        console.error(`Deleted ${configPath}`)
      } else {
        console.error('No config file to delete')
      }
    })
}
