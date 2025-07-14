import { jest } from '@jest/globals'
import { GitMutex } from '../src/git-mutex.js'

// Mock octokit
const mockOctokit = {
  rest: {
    git: {
      createRef: jest.fn(),
      deleteRef: jest.fn(),
      getRef: jest.fn(),
      getCommit: jest.fn()
    }
  }
}

// Mock environment variables
const originalEnv = process.env
beforeEach(() => {
  jest.resetAllMocks()
  process.env = {
    ...originalEnv,
    GITHUB_RUN_ID: 'test-run-123',
    GITHUB_JOB: 'test-job',
    GITHUB_SHA: 'abc123'
  }
})

afterEach(() => {
  process.env = originalEnv
})

describe('GitMutex', () => {
  let gitMutex

  beforeEach(() => {
    gitMutex = new GitMutex(mockOctokit, 'test-owner', 'test-repo', 'test-key')
  })

  describe('acquireLock', () => {
    it('successfully acquires lock on first try', async () => {
      mockOctokit.rest.git.createRef.mockResolvedValue({})

      const result = await gitMutex.acquireLock(5000, 1000)

      expect(result).toBe(true)
      expect(gitMutex.acquired).toBe(true)
      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/mutex/test-key',
        sha: 'abc123'
      })
    })

    it('retries when ref already exists', async () => {
      // First call fails (ref exists), second call succeeds
      mockOctokit.rest.git.createRef
        .mockRejectedValueOnce({ status: 422 })
        .mockResolvedValueOnce({})

      // Mock expired lock check
      mockOctokit.rest.git.getRef.mockResolvedValue({
        data: { object: { sha: 'old-sha' } }
      })
      mockOctokit.rest.git.getCommit.mockResolvedValue({
        data: {
          author: {
            date: new Date(Date.now() - 700000).toISOString() // 11+ minutes ago
          }
        }
      })
      mockOctokit.rest.git.deleteRef.mockResolvedValue({})

      const result = await gitMutex.acquireLock(10000, 1000)

      expect(result).toBe(true)
      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledTimes(2)
      expect(mockOctokit.rest.git.deleteRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'mutex/test-key'
      })
    })

    it('times out when lock cannot be acquired', async () => {
      mockOctokit.rest.git.createRef.mockRejectedValue({ status: 422 })

      // Mock non-expired lock check
      mockOctokit.rest.git.getRef.mockResolvedValue({
        data: { object: { sha: 'current-sha' } }
      })
      mockOctokit.rest.git.getCommit.mockResolvedValue({
        data: {
          author: {
            date: new Date(Date.now() - 60000).toISOString() // 1 minute ago
          }
        }
      })

      const result = await gitMutex.acquireLock(3000, 1000)

      expect(result).toBe(false)
      expect(gitMutex.acquired).toBe(false)
    })

    it('handles API errors gracefully', async () => {
      mockOctokit.rest.git.createRef.mockRejectedValue(new Error('API Error'))

      await expect(gitMutex.acquireLock(1000, 500)).rejects.toThrow('API Error')
    })
  })

  describe('releaseLock', () => {
    it('releases acquired lock successfully', async () => {
      gitMutex.acquired = true
      mockOctokit.rest.git.deleteRef.mockResolvedValue({})

      await gitMutex.releaseLock()

      expect(gitMutex.acquired).toBe(false)
      expect(mockOctokit.rest.git.deleteRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'mutex/test-key'
      })
    })

    it('handles case when ref does not exist', async () => {
      gitMutex.acquired = true
      mockOctokit.rest.git.deleteRef.mockRejectedValue({ status: 422 })

      await gitMutex.releaseLock()

      expect(gitMutex.acquired).toBe(false)
    })

    it('does nothing when lock not acquired', async () => {
      gitMutex.acquired = false

      await gitMutex.releaseLock()

      expect(mockOctokit.rest.git.deleteRef).not.toHaveBeenCalled()
    })
  })

  describe('checkAndCleanExpiredLock', () => {
    it('cleans expired lock', async () => {
      mockOctokit.rest.git.getRef.mockResolvedValue({
        data: { object: { sha: 'old-sha' } }
      })
      mockOctokit.rest.git.getCommit.mockResolvedValue({
        data: {
          author: {
            date: new Date(Date.now() - 700000).toISOString() // 11+ minutes ago
          }
        }
      })
      mockOctokit.rest.git.deleteRef.mockResolvedValue({})

      const result = await gitMutex.checkAndCleanExpiredLock()

      expect(result).toBe(true)
      expect(mockOctokit.rest.git.deleteRef).toHaveBeenCalled()
    })

    it('does not clean non-expired lock', async () => {
      mockOctokit.rest.git.getRef.mockResolvedValue({
        data: { object: { sha: 'current-sha' } }
      })
      mockOctokit.rest.git.getCommit.mockResolvedValue({
        data: {
          author: {
            date: new Date(Date.now() - 60000).toISOString() // 1 minute ago
          }
        }
      })

      const result = await gitMutex.checkAndCleanExpiredLock()

      expect(result).toBe(false)
      expect(mockOctokit.rest.git.deleteRef).not.toHaveBeenCalled()
    })

    it('handles ref not found', async () => {
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 })

      const result = await gitMutex.checkAndCleanExpiredLock()

      expect(result).toBe(true)
    })
  })
})
