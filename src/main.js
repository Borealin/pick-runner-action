import * as core from '@actions/core'
import { GitHubAPI } from './github-api.js'
import { GitMutex } from './git-mutex.js'

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    // Get inputs
    const selfHostedTagsInput = core.getInput('self-hosted-tags')
    const selfHostedTags = selfHostedTagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)

    const githubHostedTagsInput = core.getInput('github-hosted-tags')
    const githubHostedTags = githubHostedTagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)

    const githubHostedLimit = parseInt(core.getInput('github-hosted-limit'), 10)
    const githubToken = core.getInput('github-token')
    const mutexKey = core.getInput('mutex-key') // Optional mutex key
    const owner = process.env.GITHUB_REPOSITORY_OWNER
    const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]

    core.info(`Checking runners for owner: ${owner}`)
    core.info(`Repository: ${repo}`)
    core.info(`Self-hosted tags: ${selfHostedTags.join(', ')}`)
    core.info(`GitHub-hosted tags: ${githubHostedTags.join(', ')}`)
    core.info(`GitHub-hosted limit: ${githubHostedLimit} minutes`)

    // Initialize GitHub API client
    const githubApi = new GitHubAPI(githubToken)

    // Determine if this is an organization or user
    core.info('Determining repository type...')
    const isOrg = await githubApi.isOrganization(owner)
    core.info(`Repository type: ${isOrg ? 'organization' : 'user'}`)

    // Get self-hosted runners and billing info
    core.info('Fetching runner information...')
    const [runners, billingInfo] = await Promise.all([
      githubApi.getSelfHostedRunners(owner, repo, isOrg),
      githubApi.getBillingInfo(owner, isOrg)
    ])

    core.info(`Found ${runners.length} self-hosted runners`)
    if (runners.length === 0) {
      core.info(
        'ℹ️ No self-hosted runners are configured for this repository/organization'
      )
      core.info('Will use GitHub-hosted runners based on usage limits')
    }
    core.info(
      `GitHub Actions billing - Used: ${billingInfo.total_minutes_used}/${billingInfo.included_minutes} minutes`
    )

    // Check if self-hosted runners are available
    const selfHostedAvailable = githubApi.hasAvailableSelfHostedRunners(
      runners,
      selfHostedTags
    )

    if (selfHostedAvailable) {
      core.info(
        `Self-hosted runners are available and not busy: ${selfHostedTags.join(
          ', '
        )}`
      )

      // If mutex key is provided, acquire lock for exclusive access
      if (mutexKey) {
        core.info(`Acquiring mutex lock: ${mutexKey}`)
        const mutex = new GitMutex(githubApi.octokit, owner, repo, mutexKey)

        try {
          const lockAcquired = await mutex.acquireLock()

          if (!lockAcquired) {
            core.info(
              'Failed to acquire mutex lock, checking GitHub-hosted runners instead'
            )
          } else {
            // Double-check runners are still available after acquiring lock
            const latestRunners = await githubApi.getSelfHostedRunners(
              owner,
              repo,
              isOrg
            )
            const stillAvailable = githubApi.hasAvailableSelfHostedRunners(
              latestRunners,
              selfHostedTags
            )

            if (stillAvailable) {
              const selectedRunner =
                selfHostedTags.length === 1
                  ? JSON.stringify(selfHostedTags[0])
                  : JSON.stringify(selfHostedTags)
              core.setOutput('selected-runner', selectedRunner)
              core.setOutput('runner-type', 'self-hosted')
              core.setOutput(
                'reason',
                `Self-hosted runners available with mutex protection (${mutexKey})`
              )

              // Note: mutex will be automatically released by cleanup handlers
              return
            } else {
              core.info(
                'Self-hosted runners became unavailable while waiting for lock'
              )
              await mutex.releaseLock()
            }
          }
        } catch (error) {
          core.warning(`Mutex error: ${error.message}`)
          core.info('Falling back to GitHub-hosted runners')
        }
      } else {
        // No mutex requested, use self-hosted runners directly
        const selectedRunner =
          selfHostedTags.length === 1
            ? JSON.stringify(selfHostedTags[0])
            : JSON.stringify(selfHostedTags)
        core.setOutput('selected-runner', selectedRunner)
        core.setOutput('runner-type', 'self-hosted')
        core.setOutput('reason', 'Self-hosted runners are available')
        return
      }
    }

    core.info('Self-hosted runners are not available or busy')

    // Check GitHub-hosted runner usage
    const githubHostedSufficient = githubApi.hasSufficientGitHubHostedMinutes(
      billingInfo,
      githubHostedLimit
    )

    if (githubHostedSufficient) {
      const remaining =
        billingInfo.included_minutes - billingInfo.total_minutes_used
      core.info(
        `GitHub-hosted runners have sufficient remaining minutes: ${remaining} >= ${githubHostedLimit}`
      )
      const selectedRunner =
        githubHostedTags.length === 1
          ? JSON.stringify(githubHostedTags[0])
          : JSON.stringify(githubHostedTags)
      core.setOutput('selected-runner', selectedRunner)
      core.setOutput('runner-type', 'github-hosted')
      core.setOutput(
        'reason',
        `GitHub-hosted runners have sufficient remaining minutes (${remaining} >= ${githubHostedLimit})`
      )
      return
    }

    // Fallback to self-hosted runners even if busy
    const remaining =
      billingInfo.included_minutes - billingInfo.total_minutes_used
    core.info(
      `GitHub-hosted runners do not have sufficient remaining minutes: ${remaining} < ${githubHostedLimit}`
    )
    core.info(
      `Falling back to self-hosted runners even if busy ${selfHostedTags.join(
        ', '
      )}`
    )
    const selectedRunner =
      selfHostedTags.length === 1
        ? JSON.stringify(selfHostedTags[0])
        : JSON.stringify(selfHostedTags)
    core.setOutput('selected-runner', selectedRunner)
    core.setOutput('runner-type', 'self-hosted')
    core.setOutput(
      'reason',
      `GitHub-hosted runners insufficient (${remaining} < ${githubHostedLimit}), using self-hosted as fallback`
    )
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      let errorMessage = `Action failed: ${error.message}`

      // Provide helpful error messages for common issues
      if (error.message.includes('Resource not accessible by integration')) {
        errorMessage +=
          '\n\n💡 This error usually means your GitHub token lacks the required permissions.'
        errorMessage +=
          '\n   Please use a Personal Access Token (PAT) with appropriate scopes:'
        errorMessage += '\n   - For personal repos: "repo" and "user" scopes'
        errorMessage += '\n   - For org repos: "admin:org" scope'
        errorMessage += '\n   See the README for detailed setup instructions.'
      } else if (
        error.message.includes(
          'Resource not accessible by personal access token'
        )
      ) {
        errorMessage +=
          '\n\n💡 This usually means no self-hosted runners are configured for this repository.'
        errorMessage +=
          '\n   Either configure self-hosted runners or this action will use GitHub-hosted runners only.'
      } else if (
        error.message.includes('Bad credentials') ||
        error.message.includes('401')
      ) {
        errorMessage +=
          '\n\n💡 Authentication failed. Please check that your github-token is valid.'
      } else if (
        error.message.includes('404') ||
        error.message.includes('Not Found')
      ) {
        errorMessage +=
          '\n\n💡 Resource not found. Please check that the repository exists and you have access to it.'
      }

      core.setFailed(errorMessage)
    } else {
      core.setFailed('Action failed with unknown error')
    }
  }
}
