/**
 * Git Refs based mutex implementation for GitHub Actions
 * Provides exclusive access to resources using Git references as locks
 */
class GitMutex {
  constructor(octokit, owner, repo, lockKey) {
    this.octokit = octokit
    this.owner = owner
    this.repo = repo
    this.lockKey = lockKey
    this.lockRef = `mutex/${lockKey}`
    this.lockData = {
      workflow: process.env.GITHUB_RUN_ID || 'unknown',
      job: process.env.GITHUB_JOB || 'unknown',
      timestamp: Date.now(),
      sha: process.env.GITHUB_SHA || 'unknown'
    }
    this.acquired = false
  }

  /**
   * Attempt to acquire the mutex lock
   * @param {number} timeoutMs - Timeout in milliseconds (default: 5 minutes)
   * @param {number} retryIntervalMs - Retry interval in milliseconds (default: 3 seconds)
   * @returns {Promise<boolean>} True if lock acquired, false if timeout
   */
  async acquireLock(timeoutMs = 300000, retryIntervalMs = 3000) {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to create the ref (atomic operation)
        await this.octokit.rest.git.createRef({
          owner: this.owner,
          repo: this.repo,
          ref: `refs/${this.lockRef}`,
          sha: this.lockData.sha
        })

        this.acquired = true
        console.log(`Mutex lock acquired: ${this.lockKey}`)

        // Set up cleanup handlers
        this.setupCleanupHandlers()

        return true
      } catch (error) {
        if (error.status === 422) {
          // Ref already exists, check if it's expired
          const cleaned = await this.checkAndCleanExpiredLock()
          if (cleaned) {
            continue // Try again immediately
          }

          // Wait before retrying
          console.log(
            `Mutex lock busy: ${this.lockKey}, retrying in ${retryIntervalMs}ms...`
          )
          await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
        } else {
          console.error(`Mutex error: ${error.message}`)
          throw error
        }
      }
    }

    console.log(`Mutex lock timeout: ${this.lockKey}`)
    return false
  }

  /**
   * Release the mutex lock
   */
  async releaseLock() {
    if (!this.acquired) {
      return
    }

    try {
      await this.octokit.rest.git.deleteRef({
        owner: this.owner,
        repo: this.repo,
        ref: this.lockRef
      })

      this.acquired = false
      console.log(`Mutex lock released: ${this.lockKey}`)
    } catch (error) {
      if (error.status === 422) {
        // Ref doesn't exist, that's fine
        this.acquired = false
      } else {
        console.error(`Error releasing mutex lock: ${error.message}`)
      }
    }
  }

  /**
   * Check if the current lock is expired and clean it up
   * @returns {Promise<boolean>} True if lock was cleaned up
   */
  async checkAndCleanExpiredLock() {
    try {
      const { data: ref } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: this.lockRef
      })

      // Get the commit to check timestamp
      const { data: commit } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: ref.object.sha
      })

      const commitTime = new Date(commit.author.date).getTime()
      const now = Date.now()
      const lockAge = now - commitTime

      // Consider lock expired after 10 minutes
      if (lockAge > 600000) {
        console.log(
          `Cleaning expired mutex lock: ${this.lockKey} (age: ${Math.round(lockAge / 1000)}s)`
        )

        await this.octokit.rest.git.deleteRef({
          owner: this.owner,
          repo: this.repo,
          ref: this.lockRef
        })

        return true
      }
    } catch (error) {
      if (error.status === 404) {
        // Ref doesn't exist, that's fine
        return true
      }
      console.error(`Error checking expired lock: ${error.message}`)
    }

    return false
  }

  /**
   * Set up cleanup handlers to release lock on process exit
   */
  setupCleanupHandlers() {
    const cleanup = async () => {
      if (this.acquired) {
        console.log('Process exiting, releasing mutex lock...')
        await this.releaseLock()
      }
    }

    // Handle various exit scenarios
    process.on('exit', cleanup)
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught exception:', error)
      await cleanup()
      process.exit(1)
    })
  }
}

export { GitMutex }
