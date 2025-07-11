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
   * Get repository-level self-hosted runners
   * @param {string} owner - Owner name
   * @param {string} repo - Repository name
   * @returns {Promise<Object>} Promise that resolves to runners result
   */
  async getRepoRunners(owner, repo) {
    return this.octokit.rest.actions
      .listSelfHostedRunnersForRepo({
        owner,
        repo
      })
      .then((response) => ({
        type: 'repo',
        runners: response.data.runners
      }))
      .catch(() => {
        console.log('No repository-level self-hosted runners available')
        return { type: 'repo', runners: [] }
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
    const allRunners = []
    const promises = []

    // Always get repository-level runners if repo is provided
    if (repo) {
      promises.push(this.getRepoRunners(owner, repo))
    }

    // For organizations, also get organization-level runners
    if (isOrg) {
      promises.push(
        this.octokit.rest.actions
          .listSelfHostedRunnersForOrg({
            org: owner
          })
          .then((response) => ({
            type: 'org',
            runners: response.data.runners
          }))
          .catch(() => {
            console.log('No organization-level self-hosted runners available')
            return { type: 'org', runners: [] }
          })
      )
    }

    // If no promises were added, return empty array
    if (promises.length === 0) {
      console.log('No repository specified for user account')
      return []
    }

    const results = await Promise.all(promises)

    // Combine all runners from different levels
    results.forEach((result) => {
      if (result.runners && result.runners.length > 0) {
        // Add source information to each runner for debugging
        const runnersWithSource = result.runners.map((runner) => ({
          ...runner,
          _source: result.type // Add source info for debugging
        }))
        allRunners.push(...runnersWithSource)
      }
    })

    const levelDescription = isOrg ? '(org + repo level)' : '(repo level)'
    console.log(
      `Found ${allRunners.length} total self-hosted runners ${levelDescription}`
    )
    return allRunners
  }

  /**
   * Get billing information for GitHub Actions
   * @param {string} owner - Owner name (organization or user)
   * @param {boolean} isOrg - Whether this is an organization
   * @returns {Promise<Object>} Billing information
   */
  async getBillingInfo(owner, isOrg = true) {
    try {
      // Try legacy API first
      try {
        const { data } = isOrg
          ? await this.octokit.rest.billing.getGithubActionsBillingOrg({
              org: owner
            })
          : await this.octokit.rest.billing.getGithubActionsBillingUser({
              username: owner
            })
        return data
      } catch (legacyError) {
        // Fallback to new enhanced billing API
        const endpoint = isOrg
          ? 'GET /organizations/{org}/settings/billing/usage'
          : 'GET /users/{username}/settings/billing/usage'
        const params = isOrg ? { org: owner } : { username: owner }

        const now = new Date()
        const currentMonth = now.getMonth() + 1 // API uses 1-12, getMonth() returns 0-11
        const currentYear = now.getFullYear()

        const { data } = await this.octokit.request(endpoint, {
          ...params,
          year: currentYear,
          month: currentMonth,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        })

        // Transform to legacy format - only filter for actions minutes
        const actionsUsage =
          data.usageItems?.filter((item) => {
            return item.product === 'actions' && item.unitType === 'Minutes'
          }) || []

        const totalMinutes = actionsUsage.reduce(
          (sum, item) => sum + (item.quantity || 0),
          0
        )

        return {
          total_minutes_used: totalMinutes,
          included_minutes: 3000, // Default fallback - enhanced API doesn't provide this
          minutes_used_breakdown: {
            total: totalMinutes
          }
        }
      }
    } catch (error) {
      // If both APIs fail, provide a fallback response
      if (
        error.status === 410 ||
        error.message?.includes('endpoint has been moved')
      ) {
        console.log('Billing API unavailable, using default values')
        return {
          total_minutes_used: 0,
          included_minutes: 3000,
          minutes_used_breakdown: {
            total: 0
          }
        }
      }
      throw error
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
    const requiredTags = tags.map((tag) => tag.trim().toLowerCase())

    return runners.some((runner) => {
      // Check if runner is online and not busy
      if (runner.status !== 'online' || runner.busy) {
        return false
      }

      // Check if runner has all required tags (case-insensitive)
      const runnerLabels = runner.labels.map((label) =>
        label.name.toLowerCase()
      )
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
