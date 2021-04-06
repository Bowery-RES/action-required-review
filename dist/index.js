require('./sourcemap-register.js');module.exports =
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 191:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 57 );
const fs = __nccwpck_require__( 747 );
const yaml = __nccwpck_require__( 331 );

const reporter = __nccwpck_require__( 125 );
const Requirement = __nccwpck_require__( 756 );

/**
 * Load the requirements yaml file.
 *
 * @returns {Requirement[]} Requirements.
 */
async function getRequirements() {
	let reqirementsString = core.getInput( 'requirements' );

	if ( ! reqirementsString ) {
		const filename = core.getInput( 'requirements-file' );
		if ( ! filename ) {
			throw new reporter.ReportError(
				'Requirements are not found',
				new Error( 'Either `requirements` or `requirements-file` input is required' ),
				{}
			);
		}

		try {
			reqirementsString = fs.readFileSync( filename, 'utf8' );
		} catch ( error ) {
			throw new reporter.ReportError(
				`Requirements file ${ filename } could not be read`,
				error,
				{}
			);
		}
	} else if ( core.getInput( 'requirements-file' ) ) {
		core.warning( 'Ignoring input `requirements-file` because `requirements` was given' );
	}

	try {
		const requirements = yaml.load( reqirementsString, {
			onWarning: w => core.warning( `Yaml: ${ w.message }` ),
		} );
		if ( ! Array.isArray( requirements ) ) {
			throw new Error( 'Requirements file does not contain an array' );
		}

		return requirements.map( ( r, i ) => new Requirement( { name: `#${ i }`, ...r } ) );
	} catch ( error ) {
		error[ Symbol.toStringTag ] = 'Error'; // Work around weird check in WError.
		throw new reporter.ReportError( 'Requirements are not valid', error, {} );
	}
}

/**
 * Action entry point.
 */
async function main() {
	try {
		const requirements = await getRequirements();
		core.startGroup( `Loaded ${ requirements.length } review requirement(s)` );

		const reviewers = await __nccwpck_require__( 897 )();
		core.startGroup( `Found ${ reviewers.length } reviewer(s)` );
		reviewers.forEach( r => core.info( r ) );
		core.endGroup();

		const paths = await __nccwpck_require__( 244 )();
		core.startGroup( `PR affects ${ paths.length } file(s)` );
		paths.forEach( p => core.info( p ) );
		core.endGroup();

		const matchedPaths = [];
		let ok = true;
		for ( let i = 0; i < requirements.length; i++ ) {
			const r = requirements[ i ];
			core.startGroup( `Checking requirement "${ r.name }"...` );
			if ( ! r.appliesToPaths( paths, matchedPaths ) ) {
				core.endGroup();
				core.info( `Requirement "${ r.name }" does not apply to any files in this PR.` );
			} else if ( await r.isSatisfied( reviewers ) ) {
				core.endGroup();
				core.info( `Requirement "${ r.name }" is satisfied by the existing reviews.` );
			} else {
				ok = false;
				core.endGroup();
				core.error( `Requirement "${ r.name }" is not satisfied by the existing reviews.` );
			}
		}
		if ( ok ) {
			await reporter.status( reporter.STATE_SUCCESS, 'All required reviews have been provided!' );
		} else {
			await reporter.status(
				reporter.STATE_PENDING,
				reviewers.length ? 'Awaiting more reviews...' : 'Awaiting reviews...'
			);
		}
	} catch ( error ) {
		let err, state, description;
		if ( error instanceof reporter.ReportError ) {
			err = error.cause();
			state = reporter.STATE_FAILURE;
			description = error.message;
		} else {
			err = error;
			state = reporter.STATE_ERROR;
			description = 'Action encountered an error';
		}
		core.setFailed( err.message );
		core.info( err.stack );
		if ( core.getInput( 'token' ) && core.getInput( 'status' ) ) {
			await reporter.status( state, description );
		}
	}
}

main();


/***/ }),

/***/ 244:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 57 );
const github = __nccwpck_require__( 421 );
const { WError } = __nccwpck_require__( 982 );

/**
 * Fetch the paths in the current PR.
 *
 * @returns {string[]} Paths.
 */
async function fetchPaths() {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const pr = github.context.payload.pull_request.number;

	const paths = {};
	try {
		for await ( const res of octokit.paginate.iterator( octokit.pulls.listFiles, {
			owner: owner,
			repo: repo,
			pull_number: pr,
			per_page: 100,
		} ) ) {
			res.data.forEach( file => {
				paths[ file.filename ] = true;
				if ( file.previous_filename ) {
					paths[ file.previous_filename ] = true;
				}
			} );
		}
	} catch ( error ) {
		throw new WError(
			`Failed to query ${ owner }/${ repo } PR #${ pr } files from GitHub`,
			error,
			{}
		);
	}

	return Object.keys( paths ).sort();
}

module.exports = fetchPaths;


/***/ }),

/***/ 125:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 57 );
const github = __nccwpck_require__( 421 );
const { WError } = __nccwpck_require__( 982 );

const STATE_ERROR = 'error';
const STATE_FAILURE = 'failure';
const STATE_PENDING = 'pending';
const STATE_SUCCESS = 'success';

/**
 * Report a status check to GitHub.
 *
 * @param {string} state - One of the `STATE_*` constants.
 * @param {string} description - Description for the status.
 */
async function status( state, description ) {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const req = {
		owner: owner,
		repo: repo,
		sha: github.context.payload.pull_request.head.sha,
		state: state,
		target_url: `https://github.com/${ owner }/${ repo }/actions/runs/${ github.context.runId }`,
		description: description,
		context: core.getInput( 'status', { required: true } ),
	};

	if ( process.env.CI ) {
		await octokit.repos.createCommitStatus( req );
	} else {
		// eslint-disable-next-line no-console
		console.dir( req );
	}
}

/**
 * Error class for friendly GitHub Action error reporting.
 *
 * Use it like
 * ```
 * throw ReportError.create( 'Status description', originalError );
 * ```
 */
class ReportError extends WError {}

module.exports = {
	STATE_ERROR: STATE_ERROR,
	STATE_FAILURE: STATE_FAILURE,
	STATE_PENDING: STATE_PENDING,
	STATE_SUCCESS: STATE_SUCCESS,
	status: status,
	ReportError: ReportError,
};
module.exports.default = module.exports;


/***/ }),

/***/ 756:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const assert = __nccwpck_require__( 357 );
const core = __nccwpck_require__( 57 );
const { SError } = __nccwpck_require__( 982 );
const picomatch = __nccwpck_require__( 592 );

const fetchTeamMembers = __nccwpck_require__( 874 );

class RequirementError extends SError {}

/**
 * Prints a result set, then returns it.
 *
 * @param {string} label - Label for the set.
 * @param {string[]} items - Items to print. If an empty array, will print `<empty set>` instead.
 * @returns {string[]} `items`.
 */
function printSet( label, items ) {
	core.info( label + ' ' + ( items.length ? items.join( ', ' ) : '<empty set>' ) );
	return items;
}

/**
 * Build a reviewer team membership filter.
 *
 * @param {object} config - Requirements configuration object being processed.
 * @param {Array|string|object} teamConfig - Team name, or single-key object with a list of teams/objects, or array of such.
 * @param {string} indent - String for indentation.
 * @returns {Function} Function to filter an array of reviewers by membership in the team(s).
 */
function buildReviewerFilter( config, teamConfig, indent ) {
	if ( typeof teamConfig === 'string' ) {
		const team = teamConfig;
		return async function ( reviewers ) {
			const members = await fetchTeamMembers( team );
			return printSet(
				`${ indent }Members of ${ team }:`,
				reviewers.filter( reviewer => members.includes( reviewer ) )
			);
		};
	}

	let keys;
	try {
		keys = Object.keys( teamConfig );
		assert( keys.length === 1 );
	} catch {
		throw new RequirementError( 'Expected a team name or a single-keyed object.', {
			config: config,
			value: teamConfig,
		} );
	}

	const op = keys[ 0 ];
	let arg = teamConfig[ op ];

	switch ( op ) {
		case 'any-of':
		case 'all-of':
		case 'two-of':
			// These ops require an array of teams/objects.
			if ( ! Array.isArray( arg ) ) {
				throw new RequirementError( `Expected an array of teams, got ${ typeof arg }`, {
					config: config,
					value: arg,
				} );
			}
			if ( ! arg.length === 0 ) {
				throw new RequirementError( 'Expected a non-empty array of teams', {
					config: config,
					value: teamConfig,
				} );
			}
			arg = arg.map( t => buildReviewerFilter( config, t, `${ indent }  ` ) );
			break;

		default:
			throw new RequirementError( `Unrecognized operation "${ op }"`, {
				config: config,
				value: teamConfig,
			} );
	}

	if ( op === 'any-of' ) {
		return async function ( reviewers ) {
			core.info( `${ indent }Union of these:` );
			return printSet( `${ indent }=>`, [
				...new Set(
					( await Promise.all( arg.map( f => f( reviewers, `${ indent }  ` ) ) ) ).flat( 1 )
				),
			] );
		};
	}

	if ( op === 'all-of' ) {
		return async function ( reviewers ) {
			core.info( `${ indent }Union of these, if none are empty:` );
			const filtered = await Promise.all( arg.map( f => f( reviewers, `${ indent }  ` ) ) );
			if ( filtered.some( a => a.length === 0 ) ) {
				return printSet( `${ indent }=>`, [] );
			}
			return printSet( `${ indent }=>`, [ ...new Set( filtered.flat( 1 ) ) ] );
		};
	}

	if ( op === 'two-of' ) {
		return async function ( reviewers ) {
			core.info( `${ indent }Union of these, if none are empty:` );
			const teamsApprovals = await Promise.all( arg.map( f => f( reviewers, `${ indent }  ` ) ) );

			core.info( `${ indent }Test teams ${JSON.stringify(teamsApprovals)}:` );

			const teamsApprovalsCount = teamsApprovals.filter(approvals => approvals.length >= 1).length;

			if (teamsApprovalsCount < 2) {
				return printSet( `${ indent }=>`, [] );
			}

			return printSet( `${ indent }=>`, [ ...new Set( teams.flat( 1 ) ) ] );
		};
	}

	throw new RequirementError( `Unrecognized operation "${ op }"`, {
		config: config,
		value: teamConfig,
	} );
}

/**
 * Class representing an individual requirement.
 */
class Requirement {
	/**
	 * Constructor.
	 *
	 * @param {object} config - Object config
	 * @param {string[]|string} config.paths - Paths this requirement applies to. Either an array of picomatch globs, or the string "unmatched".
	 * @param {Array} config.teams - Team reviews requirements.
	 */
	constructor( config ) {
		this.name = config.name || 'Unnamed requirement';

		if ( config.paths === 'unmatched' ) {
			this.pathsFilter = null;
		} else if (
			Array.isArray( config.paths ) &&
			config.paths.every( v => typeof v === 'string' )
		) {
			this.pathsFilter = picomatch( config.paths, { dot: true } );
		} else {
			throw new RequirementError( 'Paths must be an array of strings, or the string "unmatched".', {
				config: config,
			} );
		}

		this.reviewerFilter = buildReviewerFilter( config, { 'any-of': config.teams }, '  ' );
	}

	/**
	 * Test whether this requirement applies to the passed paths.
	 *
	 * @param {string[]} paths - Paths to test against.
	 * @param {string[]} matchedPaths - Paths that have already been matched. Will be modified if true is returned.
	 * @returns {boolean} Whether the requirement applies.
	 */
	appliesToPaths( paths, matchedPaths ) {
		let matches;
		if ( this.pathsFilter ) {
			matches = paths.filter( p => this.pathsFilter( p ) );
		} else {
			matches = paths.filter( p => ! matchedPaths.includes( p ) );
			if ( matches.length === 0 ) {
				core.info( "Matches files that haven't been matched yet, but all files have." );
			}
		}

		if ( matches.length !== 0 ) {
			core.info( 'Matches the following files:' );
			matches.forEach( m => core.info( `   - ${ m }` ) );
			matchedPaths.push( ...matches.filter( p => ! matchedPaths.includes( p ) ) );
			matchedPaths.sort();
		}

		return matches.length !== 0;
	}

	/**
	 * Test whether this requirement is satisfied.
	 *
	 * @param {string[]} reviewers - Reviewers to test against.
	 * @returns {boolean} Whether the requirement is satisfied.
	 */
	async isSatisfied( reviewers ) {
		core.info( 'Checking reviewers...' );
		return ( await this.reviewerFilter( reviewers ) ).length > 0;
	}
}

module.exports = Requirement;


/***/ }),

/***/ 897:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 57 );
const github = __nccwpck_require__( 421 );
const { WError } = __nccwpck_require__( 982 );

/**
 * Fetch the reviewers approving the current PR.
 *
 * @returns {string[]} Reviewers.
 */
async function fetchReviewers() {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const pr = github.context.payload.pull_request.number;

	const reviewers = {};
	try {
		for await ( const res of octokit.paginate.iterator( octokit.pulls.listReviews, {
			owner: owner,
			repo: repo,
			pull_number: pr,
			per_page: 100,
		} ) ) {
			res.data.forEach( review => {
				if ( review.state === 'APPROVED' ) {
					reviewers[ review.user.login ] = true;
				}
			} );
		}
	} catch ( error ) {
		throw new WError(
			`Failed to query ${ owner }/${ repo } PR #${ pr } reviewers from GitHub`,
			error,
			{}
		);
	}

	return Object.keys( reviewers ).sort();
}

module.exports = fetchReviewers;


/***/ }),

/***/ 874:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 57 );
const github = __nccwpck_require__( 421 );
const { WError } = __nccwpck_require__( 982 );

const cache = {};

/**
 * Fetch the members of a team.
 *
 * @param {string} team - GitHub team slug.
 * @returns {string[]} Team members.
 */
async function fetchTeamMembers( team ) {
	if ( cache[ team ] ) {
		return cache[ team ];
	}

	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const org = github.context.payload.repository.owner.login;

	let members = [];
	try {
		for await ( const res of octokit.paginate.iterator( octokit.teams.listMembersInOrg, {
			org: org,
			team_slug: team,
			per_page: 100,
		} ) ) {
			members = members.concat( res.data.map( v => v.login ) );
		}
	} catch ( error ) {
		throw new WError( `Failed to query ${ org } team ${ team } from GitHub`, error, {} );
	}

	cache[ team ] = members;
	return members;
}

module.exports = fetchTeamMembers;


/***/ }),

/***/ 57:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 421:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 982:
/***/ ((module) => {

module.exports = eval("require")("error");


/***/ }),

/***/ 331:
/***/ ((module) => {

module.exports = eval("require")("js-yaml");


/***/ }),

/***/ 592:
/***/ ((module) => {

module.exports = eval("require")("picomatch");


/***/ }),

/***/ 357:
/***/ ((module) => {

"use strict";
module.exports = require("assert");;

/***/ }),

/***/ 747:
/***/ ((module) => {

"use strict";
module.exports = require("fs");;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		if(__webpack_module_cache__[moduleId]) {
/******/ 			return __webpack_module_cache__[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	__nccwpck_require__.ab = __dirname + "/";/************************************************************************/
/******/ 	// module exports must be returned from runtime so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	return __nccwpck_require__(191);
/******/ })()
;
//# sourceMappingURL=index.js.map