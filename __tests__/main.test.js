/**
 * Unit tests for the action's main functionality, src/main.js
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mock GitHubAPI
const mockGitHubAPI = {
  getSelfHostedRunners: jest.fn(),
  getBillingInfo: jest.fn(),
  isOrganization: jest.fn(),
  hasAvailableSelfHostedRunners: jest.fn(),
  hasSufficientGitHubHostedMinutes: jest.fn(),
  octokit: {
    rest: {
      git: {
        createRef: jest.fn(),
        deleteRef: jest.fn(),
        getRef: jest.fn(),
        getCommit: jest.fn()
      }
    }
  }
}

// Mock GitMutex
const mockGitMutex = {
  acquireLock: jest.fn(),
  releaseLock: jest.fn()
}

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/github-api.js', () => ({
  GitHubAPI: jest.fn().mockImplementation(() => mockGitHubAPI)
}))
jest.unstable_mockModule('../src/git-mutex.js', () => ({
  GitMutex: jest.fn().mockImplementation(() => mockGitMutex)
}))

// The module being tested should be imported dynamically.
const { run } = await import('../src/main.js')

describe('main.js', () => {
  beforeEach(() => {
    // Set default inputs
    core.getInput.mockImplementation((input) => {
      switch (input) {
        case 'self-hosted-tags':
          return 'linux,self-hosted'
        case 'github-hosted-tags':
          return 'ubuntu-latest'
        case 'github-hosted-limit':
          return '1000'
        case 'github-token':
          return 'fake-token'
        default:
          return ''
      }
    })

    // Mock environment variables
    process.env.GITHUB_REPOSITORY_OWNER = 'test-org'
    process.env.GITHUB_REPOSITORY = 'test-org/test-repo'

    // Default mock implementations
    mockGitHubAPI.getSelfHostedRunners.mockResolvedValue([])
    mockGitHubAPI.getBillingInfo.mockResolvedValue({
      included_minutes: 3000,
      total_minutes_used: 1000
    })
    mockGitHubAPI.isOrganization.mockResolvedValue(true)
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(false)
    mockGitHubAPI.hasSufficientGitHubHostedMinutes.mockReturnValue(true)

    // Reset mutex mock
    mockGitMutex.acquireLock.mockResolvedValue(true)
    mockGitMutex.releaseLock.mockResolvedValue()
  })

  afterEach(() => {
    jest.clearAllMocks()
    delete process.env.GITHUB_REPOSITORY_OWNER
    delete process.env.GITHUB_REPOSITORY
  })

  it('Selects self-hosted runners when available', async () => {
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(true)

    await run()

    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '["linux","self-hosted"]'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'self-hosted')
    expect(core.setOutput).toHaveBeenCalledWith(
      'reason',
      'Self-hosted runners are available'
    )
  })

  it('Selects GitHub-hosted runners when self-hosted busy but sufficient minutes', async () => {
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(false)
    mockGitHubAPI.hasSufficientGitHubHostedMinutes.mockReturnValue(true)

    await run()

    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '"ubuntu-latest"'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'github-hosted')
    expect(core.setOutput).toHaveBeenCalledWith(
      'reason',
      'GitHub-hosted runners have sufficient remaining minutes (2000 >= 1000)'
    )
  })

  it('Falls back to self-hosted runners when GitHub-hosted minutes insufficient', async () => {
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(false)
    mockGitHubAPI.hasSufficientGitHubHostedMinutes.mockReturnValue(false)

    await run()

    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '["linux","self-hosted"]'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'self-hosted')
    expect(core.setOutput).toHaveBeenCalledWith(
      'reason',
      'GitHub-hosted runners insufficient (2000 < 1000), using self-hosted as fallback'
    )
  })

  it('Handles single tag output correctly', async () => {
    core.getInput.mockImplementation((input) => {
      switch (input) {
        case 'self-hosted-tags':
          return 'linux'
        case 'github-hosted-tags':
          return 'ubuntu-latest'
        case 'github-hosted-limit':
          return '1000'
        case 'github-token':
          return 'fake-token'
        default:
          return ''
      }
    })

    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(true)

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('selected-runner', '"linux"')
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'self-hosted')
  })

  it('Handles API errors gracefully', async () => {
    mockGitHubAPI.getSelfHostedRunners.mockRejectedValue(new Error('API Error'))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Action failed: API Error')
  })

  it('Works with user repositories', async () => {
    // Mock user repository
    process.env.GITHUB_REPOSITORY_OWNER = 'test-user'
    process.env.GITHUB_REPOSITORY = 'test-user/test-repo'
    mockGitHubAPI.isOrganization.mockResolvedValue(false)
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(true)

    await run()

    expect(mockGitHubAPI.isOrganization).toHaveBeenCalledWith('test-user')
    expect(mockGitHubAPI.getSelfHostedRunners).toHaveBeenCalledWith(
      'test-user',
      'test-repo',
      false
    )
    expect(mockGitHubAPI.getBillingInfo).toHaveBeenCalledWith(
      'test-user',
      false
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '["linux","self-hosted"]'
    )
  })

  it('Works when no self-hosted runners are configured', async () => {
    // Mock no self-hosted runners available
    mockGitHubAPI.getSelfHostedRunners.mockResolvedValue([])
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(false)
    mockGitHubAPI.hasSufficientGitHubHostedMinutes.mockReturnValue(true)

    await run()

    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '"ubuntu-latest"'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'github-hosted')
    expect(core.setOutput).toHaveBeenCalledWith(
      'reason',
      'GitHub-hosted runners have sufficient remaining minutes (2000 >= 1000)'
    )
  })

  it('Uses mutex lock when mutex-key is provided and self-hosted runners are available', async () => {
    // Mock mutex key input
    core.getInput.mockImplementation((input) => {
      switch (input) {
        case 'self-hosted-tags':
          return 'linux,self-hosted'
        case 'github-hosted-tags':
          return 'ubuntu-latest'
        case 'github-hosted-limit':
          return '1000'
        case 'github-token':
          return 'fake-token'
        case 'mutex-key':
          return 'test-mutex'
        default:
          return ''
      }
    })

    // Mock self-hosted runners available
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(true)
    mockGitMutex.acquireLock.mockResolvedValue(true)

    await run()

    expect(mockGitMutex.acquireLock).toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '["linux","self-hosted"]'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'self-hosted')
    expect(core.setOutput).toHaveBeenCalledWith(
      'reason',
      'Self-hosted runners available with mutex protection (test-mutex)'
    )
  })

  it('Falls back to GitHub-hosted when mutex lock fails', async () => {
    // Mock mutex key input
    core.getInput.mockImplementation((input) => {
      switch (input) {
        case 'self-hosted-tags':
          return 'linux,self-hosted'
        case 'github-hosted-tags':
          return 'ubuntu-latest'
        case 'github-hosted-limit':
          return '1000'
        case 'github-token':
          return 'fake-token'
        case 'mutex-key':
          return 'test-mutex'
        default:
          return ''
      }
    })

    // Mock self-hosted runners available but mutex lock fails
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(true)
    mockGitMutex.acquireLock.mockResolvedValue(false) // Lock timeout
    mockGitHubAPI.hasSufficientGitHubHostedMinutes.mockReturnValue(true)

    await run()

    expect(mockGitMutex.acquireLock).toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '"ubuntu-latest"'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'github-hosted')
  })

  it('Works without mutex when mutex-key is not provided', async () => {
    // Mock no mutex key (default behavior)
    mockGitHubAPI.hasAvailableSelfHostedRunners.mockReturnValue(true)

    await run()

    expect(mockGitMutex.acquireLock).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'selected-runner',
      '["linux","self-hosted"]'
    )
    expect(core.setOutput).toHaveBeenCalledWith('runner-type', 'self-hosted')
    expect(core.setOutput).toHaveBeenCalledWith(
      'reason',
      'Self-hosted runners are available'
    )
  })
})
