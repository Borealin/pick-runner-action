/**
 * Unit tests for the GitHubAPI class
 */
import { jest } from '@jest/globals'

// Mock Octokit
const mockOctokit = {
  rest: {
    actions: {
      listSelfHostedRunnersForOrg: jest.fn(),
      listSelfHostedRunnersForRepo: jest.fn()
    },
    billing: {
      getGithubActionsBillingOrg: jest.fn(),
      getGithubActionsBillingUser: jest.fn()
    },
    orgs: {
      get: jest.fn()
    }
  },
  request: jest.fn()
}

jest.unstable_mockModule('@octokit/rest', () => ({
  Octokit: jest.fn(() => mockOctokit)
}))

const { GitHubAPI } = await import('../src/github-api.js')

describe('GitHubAPI', () => {
  let githubApi

  beforeEach(() => {
    githubApi = new GitHubAPI('fake-token')
    jest.clearAllMocks()
  })

  describe('getSelfHostedRunners', () => {
    it('calls org API for organization repositories', async () => {
      const mockRunners = [
        { id: 1, name: 'runner-1', status: 'online', busy: false }
      ]
      mockOctokit.rest.actions.listSelfHostedRunnersForOrg.mockResolvedValue({
        data: { runners: mockRunners }
      })

      const result = await githubApi.getSelfHostedRunners(
        'test-org',
        null,
        true
      )

      expect(
        mockOctokit.rest.actions.listSelfHostedRunnersForOrg
      ).toHaveBeenCalledWith({
        org: 'test-org'
      })
      expect(result).toEqual(mockRunners)
    })

    it('calls repo API for user repositories', async () => {
      const mockRunners = [
        { id: 2, name: 'runner-2', status: 'online', busy: true }
      ]
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: { runners: mockRunners }
      })

      const result = await githubApi.getSelfHostedRunners(
        'test-user',
        'test-repo',
        false
      )

      expect(
        mockOctokit.rest.actions.listSelfHostedRunnersForRepo
      ).toHaveBeenCalledWith({
        owner: 'test-user',
        repo: 'test-repo'
      })
      expect(result).toEqual(mockRunners)
    })

    it('returns empty array when no self-hosted runners are configured', async () => {
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockRejectedValue({
        status: 403,
        message: 'Resource not accessible by personal access token'
      })

      const result = await githubApi.getSelfHostedRunners(
        'test-user',
        'test-repo',
        false
      )

      expect(result).toEqual([])
    })

    it('throws error for other API errors in getSelfHostedRunners', async () => {
      mockOctokit.rest.actions.listSelfHostedRunnersForOrg.mockRejectedValue({
        status: 500,
        message: 'Server Error'
      })

      await expect(
        githubApi.getSelfHostedRunners('test-org', null, true)
      ).rejects.toEqual({
        status: 500,
        message: 'Server Error'
      })
    })
  })

  describe('getBillingInfo', () => {
    it('uses legacy billing API for organizations when available', async () => {
      const mockBilling = {
        total_minutes_used: 1000,
        included_minutes: 3000
      }
      mockOctokit.rest.billing.getGithubActionsBillingOrg.mockResolvedValue({
        data: mockBilling
      })

      const result = await githubApi.getBillingInfo('test-org', true)

      expect(
        mockOctokit.rest.billing.getGithubActionsBillingOrg
      ).toHaveBeenCalledWith({
        org: 'test-org'
      })
      expect(result).toEqual(mockBilling)
    })

    it('falls back to enhanced API for organizations when legacy API fails', async () => {
      const mockEnhancedResponse = {
        usageItems: [
          {
            product: 'actions',
            quantity: 1000,
            unitType: 'Minutes'
          },
          {
            product: 'codespaces',
            quantity: 500,
            unitType: 'Hours'
          }
        ]
      }
      mockOctokit.rest.billing.getGithubActionsBillingOrg.mockRejectedValue(
        new Error('Legacy API not available')
      )
      mockOctokit.request.mockResolvedValue({
        data: mockEnhancedResponse
      })

      const result = await githubApi.getBillingInfo('test-org', true)

      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /organizations/{org}/settings/billing/usage',
        {
          org: 'test-org',
          year: expect.any(Number),
          month: expect.any(Number),
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      )
      expect(result).toEqual({
        total_minutes_used: 1000,
        included_minutes: 3000,
        minutes_used_breakdown: {
          total: 1000
        }
      })
    })

    it('uses legacy billing API for users when available', async () => {
      const mockBilling = {
        total_minutes_used: 500,
        included_minutes: 3000
      }
      mockOctokit.rest.billing.getGithubActionsBillingUser.mockResolvedValue({
        data: mockBilling
      })

      const result = await githubApi.getBillingInfo('test-user', false)

      expect(
        mockOctokit.rest.billing.getGithubActionsBillingUser
      ).toHaveBeenCalledWith({
        username: 'test-user'
      })
      expect(result).toEqual(mockBilling)
    })

    it('falls back to enhanced API for users when legacy API fails', async () => {
      const mockEnhancedResponse = {
        usageItems: [
          {
            product: 'actions',
            quantity: 500,
            unitType: 'Minutes'
          }
        ]
      }
      mockOctokit.rest.billing.getGithubActionsBillingUser.mockRejectedValue(
        new Error('Legacy API not available')
      )
      mockOctokit.request.mockResolvedValue({
        data: mockEnhancedResponse
      })

      const result = await githubApi.getBillingInfo('test-user', false)

      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /users/{username}/settings/billing/usage',
        {
          username: 'test-user',
          year: expect.any(Number),
          month: expect.any(Number),
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      )
      expect(result).toEqual({
        total_minutes_used: 500,
        included_minutes: 3000,
        minutes_used_breakdown: {
          total: 500
        }
      })
    })

    it('provides fallback when billing APIs are unavailable', async () => {
      mockOctokit.rest.billing.getGithubActionsBillingUser.mockRejectedValue({
        status: 410,
        message: 'This endpoint has been moved'
      })
      mockOctokit.request.mockRejectedValue({
        status: 410,
        message: 'This endpoint has been moved'
      })

      const result = await githubApi.getBillingInfo('test-user', false)

      expect(result).toEqual({
        total_minutes_used: 0,
        included_minutes: 3000,
        minutes_used_breakdown: {
          total: 0
        }
      })
    })
  })

  describe('isOrganization', () => {
    it('returns true for organizations', async () => {
      mockOctokit.rest.orgs.get.mockResolvedValue({
        data: { login: 'test-org' }
      })

      const result = await githubApi.isOrganization('test-org')

      expect(mockOctokit.rest.orgs.get).toHaveBeenCalledWith({
        org: 'test-org'
      })
      expect(result).toBe(true)
    })

    it('returns false for users (404 error)', async () => {
      mockOctokit.rest.orgs.get.mockRejectedValue({
        status: 404
      })

      const result = await githubApi.isOrganization('test-user')

      expect(result).toBe(false)
    })

    it('throws error for other API errors', async () => {
      mockOctokit.rest.orgs.get.mockRejectedValue({
        status: 500,
        message: 'Server Error'
      })

      await expect(githubApi.isOrganization('test-org')).rejects.toEqual({
        status: 500,
        message: 'Server Error'
      })
    })
  })

  describe('hasAvailableSelfHostedRunners', () => {
    it('returns true when runners are available', () => {
      const runners = [
        {
          status: 'online',
          busy: false,
          labels: [{ name: 'linux' }, { name: 'self-hosted' }]
        }
      ]
      const tags = ['linux', 'self-hosted']

      const result = githubApi.hasAvailableSelfHostedRunners(runners, tags)

      expect(result).toBe(true)
    })

    it('returns false when runners are offline', () => {
      const runners = [
        {
          status: 'offline',
          busy: false,
          labels: [{ name: 'linux' }, { name: 'self-hosted' }]
        }
      ]
      const tags = ['linux', 'self-hosted']

      const result = githubApi.hasAvailableSelfHostedRunners(runners, tags)

      expect(result).toBe(false)
    })

    it('returns false when runners are busy', () => {
      const runners = [
        {
          status: 'online',
          busy: true,
          labels: [{ name: 'linux' }, { name: 'self-hosted' }]
        }
      ]
      const tags = ['linux', 'self-hosted']

      const result = githubApi.hasAvailableSelfHostedRunners(runners, tags)

      expect(result).toBe(false)
    })

    it('returns false when runners do not have required tags', () => {
      const runners = [
        {
          status: 'online',
          busy: false,
          labels: [{ name: 'windows' }, { name: 'self-hosted' }]
        }
      ]
      const tags = ['linux', 'self-hosted']

      const result = githubApi.hasAvailableSelfHostedRunners(runners, tags)

      expect(result).toBe(false)
    })

    it('returns true when at least one runner matches all criteria', () => {
      const runners = [
        {
          status: 'offline',
          busy: false,
          labels: [{ name: 'linux' }, { name: 'self-hosted' }]
        },
        {
          status: 'online',
          busy: false,
          labels: [{ name: 'linux' }, { name: 'self-hosted' }]
        }
      ]
      const tags = ['linux', 'self-hosted']

      const result = githubApi.hasAvailableSelfHostedRunners(runners, tags)

      expect(result).toBe(true)
    })

    it('handles empty runners array', () => {
      const runners = []
      const tags = ['linux', 'self-hosted']

      const result = githubApi.hasAvailableSelfHostedRunners(runners, tags)

      expect(result).toBe(false)
    })
  })

  describe('hasSufficientGitHubHostedMinutes', () => {
    it('returns true when remaining minutes >= limit', () => {
      const billingInfo = {
        included_minutes: 3000,
        total_minutes_used: 1000
      }
      const limit = 1500

      const result = githubApi.hasSufficientGitHubHostedMinutes(
        billingInfo,
        limit
      )

      expect(result).toBe(true)
    })

    it('returns true when remaining minutes = limit', () => {
      const billingInfo = {
        included_minutes: 3000,
        total_minutes_used: 1000
      }
      const limit = 2000

      const result = githubApi.hasSufficientGitHubHostedMinutes(
        billingInfo,
        limit
      )

      expect(result).toBe(true)
    })

    it('returns false when remaining minutes < limit', () => {
      const billingInfo = {
        included_minutes: 3000,
        total_minutes_used: 2500
      }
      const limit = 1000

      const result = githubApi.hasSufficientGitHubHostedMinutes(
        billingInfo,
        limit
      )

      expect(result).toBe(false)
    })

    it('handles case when all minutes are used', () => {
      const billingInfo = {
        included_minutes: 3000,
        total_minutes_used: 3000
      }
      const limit = 100

      const result = githubApi.hasSufficientGitHubHostedMinutes(
        billingInfo,
        limit
      )

      expect(result).toBe(false)
    })

    it('handles case when usage exceeds included minutes', () => {
      const billingInfo = {
        included_minutes: 3000,
        total_minutes_used: 3500
      }
      const limit = 100

      const result = githubApi.hasSufficientGitHubHostedMinutes(
        billingInfo,
        limit
      )

      expect(result).toBe(false)
    })
  })
})
