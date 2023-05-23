const core = require('@actions/core');
const github = require('@actions/github');
const { WError } = require('error');

/**
 * Fetch the labels of a PR.
 *
 * @returns {string[]} Labels.
 */
async function fetchLabels() {
	const octokit = github.getOctokit(core.getInput('token', { required: true }));

	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const prNumber = github.context.payload.pull_request.number;

	try {
		const response = await octokit.pulls.get({
			owner: owner,
			repo: repo,
			pull_number: prNumber,
		});
		core.info(response);
		core.info(response.data);
		core.info(response.data.labels);

		return response.data.labels.map((label) => label.name);
	} catch (error) {
		core.info(err.stack);
		throw new WError(
			`Failed to query ${owner}/${repo} PR #${prNumber} labels from GitHub`,
			error,
			{}
		);
	}
}

module.exports = fetchLabels;
