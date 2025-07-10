import * as core from '@actions/core'
import { GitHubAPI } from './github-api.js'

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
    const organization = process.env.GITHUB_REPOSITORY_OWNER

    core.info(`Checking runners for organization: ${organization}`)
    core.info(`Self-hosted tags: ${selfHostedTags.join(', ')}`)
    core.info(`GitHub-hosted tags: ${githubHostedTags.join(', ')}`)
    core.info(`GitHub-hosted limit: ${githubHostedLimit} minutes`)

    // Initialize GitHub API client
    const githubApi = new GitHubAPI(githubToken)

    // Get self-hosted runners and billing info
    core.info('Fetching runner information...')
    const [runners, billingInfo] = await Promise.all([
      githubApi.getSelfHostedRunners(organization),
      githubApi.getBillingInfo(organization)
    ])

    core.info(`Found ${runners.length} self-hosted runners`)
    core.info(
      `GitHub Actions billing - Used: ${billingInfo.total_minutes_used}/${billingInfo.included_minutes} minutes`
    )

    // Check if self-hosted runners are available
    const selfHostedAvailable = githubApi.hasAvailableSelfHostedRunners(
      runners,
      selfHostedTags
    )

    if (selfHostedAvailable) {
      core.info('Self-hosted runners are available and not busy')
      const selectedRunner =
        selfHostedTags.length === 1
          ? JSON.stringify(selfHostedTags[0])
          : JSON.stringify(selfHostedTags)
      core.setOutput('selected-runner', selectedRunner)
      core.setOutput('runner-type', 'self-hosted')
      core.setOutput('reason', 'Self-hosted runners are available')
      return
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
    core.info('Falling back to self-hosted runners even if busy')
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
      core.setFailed(`Action failed: ${error.message}`)
    } else {
      core.setFailed('Action failed with unknown error')
    }
  }
}
