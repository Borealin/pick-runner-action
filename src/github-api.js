import { Octokit } from '@octokit/rest'

/**
 * GitHub API client for runner management
 */
export class GitHubAPI {
  constructor(token) {
    this.octokit = new Octokit({
      auth: token
    })
  }

  /**
   * Get all self-hosted runners for an organization or user
   * @param {string} owner - Owner name (organization or user)
   * @param {string} repo - Repository name (for user repos)
   * @param {boolean} isOrg - Whether this is an organization
   * @returns {Promise<Array>} Array of runner objects
   */
  async getSelfHostedRunners(owner, repo = null, isOrg = true) {
    if (isOrg) {
      const { data } =
        await this.octokit.rest.actions.listSelfHostedRunnersForOrg({
          org: owner
        })
      return data.runners
    } else {
      const { data } =
        await this.octokit.rest.actions.listSelfHostedRunnersForRepo({
          owner,
          repo
        })
      return data.runners
    }
  }

  /**
   * Get billing information for GitHub Actions
   * @param {string} owner - Owner name (organization or user)
   * @param {boolean} isOrg - Whether this is an organization
   * @returns {Promise<Object>} Billing information
   */
  async getBillingInfo(owner, isOrg = true) {
    if (isOrg) {
      const { data } =
        await this.octokit.rest.billing.getGithubActionsBillingOrg({
          org: owner
        })
      return data
    } else {
      const { data } =
        await this.octokit.rest.billing.getGithubActionsBillingUser({
          username: owner
        })
      return data
    }
  }

  /**
   * Determine if owner is an organization by checking if it has organization-specific data
   * @param {string} owner - Owner name
   * @returns {Promise<boolean>} True if owner is an organization
   */
  async isOrganization(owner) {
    try {
      await this.octokit.rest.orgs.get({ org: owner })
      return true
    } catch (error) {
      if (error.status === 404) {
        return false
      }
      throw error
    }
  }

  /**
   * Check if self-hosted runners are available (online and not busy)
   * @param {Array} runners - Array of runner objects
   * @param {Array} tags - Required tags
   * @returns {boolean} True if available runners found
   */
  hasAvailableSelfHostedRunners(runners, tags) {
    const requiredTags = tags.map((tag) => tag.trim())

    return runners.some((runner) => {
      // Check if runner is online and not busy
      if (runner.status !== 'online' || runner.busy) {
        return false
      }

      // Check if runner has all required tags
      const runnerLabels = runner.labels.map((label) => label.name)
      return requiredTags.every((tag) => runnerLabels.includes(tag))
    })
  }

  /**
   * Check if GitHub-hosted runners have sufficient remaining minutes
   * @param {Object} billingInfo - Billing information
   * @param {number} limit - Minimum remaining minutes threshold
   * @returns {boolean} True if sufficient minutes available
   */
  hasSufficientGitHubHostedMinutes(billingInfo, limit) {
    const remaining =
      billingInfo.included_minutes - billingInfo.total_minutes_used
    return remaining >= limit
  }
}
