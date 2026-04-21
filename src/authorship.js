const DEFAULT_TOP_SLICES = 10;
const REF_SPAN_RE =
    /<ref(?=[\s>/]|name=|group=)[^>]*?\/>|<ref(?=[\s>/]|name=|group=)[^>]*?>[\s\S]*?<\/ref\s*>/gi;
const TEMPLATE_PREFIX_RE = /^template:/i;
const textEncoder = new TextEncoder();

export { DEFAULT_TOP_SLICES };

function byteLength( text ) {
    return textEncoder.encode( text ).length;
}

function incrementMap( map, key, amount ) {
    map.set( key, ( map.get( key ) || 0 ) + amount );
}

function chunk( items, size ) {
    const groups = [];
    for ( let index = 0; index < items.length; index += size ) {
        groups.push( items.slice( index, index + size ) );
    }
    return groups;
}

function mergeSpans( spans ) {
    if ( spans.length === 0 ) {
        return [];
    }
    const merged = [];
    spans
        .slice()
        .sort( function ( a, b ) {
            if ( a[ 0 ] !== b[ 0 ] ) {
                return a[ 0 ] - b[ 0 ];
            }
            return a[ 1 ] - b[ 1 ];
        } )
        .forEach( function ( span ) {
            if ( span[ 0 ] >= span[ 1 ] ) {
                return;
            }
            if ( merged.length === 0 || span[ 0 ] > merged[ merged.length - 1 ][ 1 ] ) {
                merged.push( [ span[ 0 ], span[ 1 ] ] );
                return;
            }
            merged[ merged.length - 1 ][ 1 ] = Math.max(
                merged[ merged.length - 1 ][ 1 ],
                span[ 1 ]
            );
        } );
    return merged;
}

function findTemplateSpans( text ) {
    const spans = [];
    const stack = [];
    let index = 0;
    const limit = text.length - 1;

    while ( index < limit ) {
        if ( text.startsWith( '<!--', index ) ) {
            const commentEnd = text.indexOf( '-->', index + 4 );
            if ( commentEnd === -1 ) {
                break;
            }
            index = commentEnd + 3;
            continue;
        }

        const pair = text.slice( index, index + 2 );
        if ( pair === '{{' ) {
            stack.push( index );
            index += 2;
            continue;
        }
        if ( pair === '}}' && stack.length ) {
            spans.push( [ stack.pop(), index + 2 ] );
            index += 2;
            continue;
        }
        index += 1;
    }

    return spans;
}

function splitTopLevel( text, delimiter ) {
    const parts = [];
    let start = 0;
    let curlyDepth = 0;
    let squareDepth = 0;
    let index = 0;

    while ( index < text.length ) {
        if ( text.startsWith( '<!--', index ) ) {
            const commentEnd = text.indexOf( '-->', index + 4 );
            if ( commentEnd === -1 ) {
                break;
            }
            index = commentEnd + 3;
            continue;
        }
        if ( text.startsWith( '{{', index ) ) {
            curlyDepth += 1;
            index += 2;
            continue;
        }
        if ( text.startsWith( '}}', index ) && curlyDepth ) {
            curlyDepth -= 1;
            index += 2;
            continue;
        }
        if ( text.startsWith( '[[', index ) ) {
            squareDepth += 1;
            index += 2;
            continue;
        }
        if ( text.startsWith( ']]', index ) && squareDepth ) {
            squareDepth -= 1;
            index += 2;
            continue;
        }
        if ( text.charAt( index ) === delimiter && curlyDepth === 0 && squareDepth === 0 ) {
            parts.push( text.slice( start, index ) );
            start = index + 1;
        }
        index += 1;
    }
    parts.push( text.slice( start ) );
    return parts;
}

function parseTemplateName( templateText ) {
    if ( !templateText.startsWith( '{{' ) || !templateText.endsWith( '}}' ) ) {
        return null;
    }
    const body = templateText.slice( 2, -2 );
    const parts = splitTopLevel( body, '|' );
    if ( parts.length === 0 ) {
        return null;
    }
    return parts[ 0 ].trim().replace( TEMPLATE_PREFIX_RE, '' ).trim().toLowerCase() || null;
}

function buildExclusionSpans( text ) {
    const spans = [];
    let match;

    REF_SPAN_RE.lastIndex = 0;
    while ( ( match = REF_SPAN_RE.exec( text ) ) !== null ) {
        spans.push( [ match.index, match.index + match[ 0 ].length ] );
    }

    findTemplateSpans( text ).forEach( function ( span ) {
        if ( parseTemplateName( text.slice( span[ 0 ], span[ 1 ] ) ) === 'r' ) {
            spans.push( span );
        }
    } );

    return mergeSpans( spans );
}

function countIncludedTokenBytes( tokenText, tokenStart, exclusionSpans, spanIndex ) {
    const tokenEnd = tokenStart + tokenText.length;

    while ( spanIndex < exclusionSpans.length && exclusionSpans[ spanIndex ][ 1 ] <= tokenStart ) {
        spanIndex += 1;
    }

    let includedBytes = 0;
    let current = tokenStart;
    let localIndex = spanIndex;

    while ( localIndex < exclusionSpans.length && exclusionSpans[ localIndex ][ 0 ] < tokenEnd ) {
        const span = exclusionSpans[ localIndex ];
        if ( current < span[ 0 ] ) {
            includedBytes += byteLength(
                tokenText.slice( current - tokenStart, span[ 0 ] - tokenStart )
            );
        }
        current = Math.max( current, span[ 1 ] );
        if ( current >= tokenEnd ) {
            break;
        }
        localIndex += 1;
    }

    if ( current < tokenEnd ) {
        includedBytes += byteLength( tokenText.slice( current - tokenStart ) );
    }

    return [ includedBytes, spanIndex ];
}

function computeEditorByteMaps( tokens ) {
    const fullBytesByEditor = new Map();
    const filteredBytesByEditor = new Map();
    const revisionText = tokens
        .filter( function ( token ) {
            return token && typeof token.str === 'string';
        } )
        .map( function ( token ) {
            return token.str;
        } )
        .join( '' );
    const exclusionSpans = buildExclusionSpans( revisionText );

    let cursor = 0;
    let spanIndex = 0;

    tokens.forEach( function ( token ) {
        if (
            !token ||
            typeof token.editor !== 'string' ||
            typeof token.str !== 'string'
        ) {
            return;
        }

        const fullBytes = byteLength( token.str );
        incrementMap( fullBytesByEditor, token.editor, fullBytes );

        const result = countIncludedTokenBytes(
            token.str,
            cursor,
            exclusionSpans,
            spanIndex
        );
        const includedBytes = result[ 0 ];
        spanIndex = result[ 1 ];
        if ( includedBytes > 0 ) {
            incrementMap( filteredBytesByEditor, token.editor, includedBytes );
        }
        cursor += token.str.length;
    } );

    return {
        fullBytesByEditor: fullBytesByEditor,
        filteredBytesByEditor: filteredBytesByEditor
    };
}

async function fetchLatestRevisionData( title, wiki, signal ) {
    const url = `https://wikiwho.wmcloud.org/${ wiki }/api/v1.0.0-beta/latest_rev_content/${ encodeURIComponent(
        title
    ) }/?editor=true`;
    const response = await fetch( url, {
        headers: {
            Accept: 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        signal: signal
    } );

    if ( !response.ok ) {
        throw new Error( `WikiWho request failed with HTTP ${ response.status }` );
    }

    const data = await response.json();
    if ( !data || data.success !== true ) {
        throw new Error(
            `WikiWho request failed: ${ ( data && data.message ) || 'unknown error' }`
        );
    }
    if ( !Array.isArray( data.revisions ) || data.revisions.length === 0 ) {
        throw new Error( 'WikiWho returned no revisions' );
    }

    const latestWrapper = data.revisions[ 0 ];
    if ( !latestWrapper || typeof latestWrapper !== 'object' ) {
        throw new Error( 'WikiWho returned an invalid revision payload' );
    }

    const entries = Object.entries( latestWrapper );
    if ( entries.length === 0 || !entries[ 0 ][ 1 ] || typeof entries[ 0 ][ 1 ] !== 'object' ) {
        throw new Error( 'WikiWho returned malformed revision data' );
    }

    return {
        articleTitle: typeof data.article_title === 'string' ? data.article_title : title,
        revisionId: String( entries[ 0 ][ 0 ] ),
        revisionData: entries[ 0 ][ 1 ]
    };
}

async function resolveEditorLabels( api, editorIds ) {
    const labelsByEditor = new Map();
    const numericIds = editorIds.filter( function ( editorId ) {
        return /^\d+$/.test( editorId );
    } );

    for ( const group of chunk( numericIds, 50 ) ) {
        const response = await api.get( {
            action: 'query',
            list: 'users',
            ususerids: group.join( '|' ),
            formatversion: 2
        } );
        const users =
            response && response.query && Array.isArray( response.query.users )
                ? response.query.users
                : [];

        users.forEach( function ( user ) {
            if ( user && typeof user.userid === 'number' && typeof user.name === 'string' ) {
                labelsByEditor.set( String( user.userid ), user.name );
            }
        } );
    }

    return labelsByEditor;
}

function resolveEditorLabel( editorId, labelsByEditor, localization ) {
    if ( labelsByEditor.has( editorId ) ) {
        return labelsByEditor.get( editorId );
    }
    if ( editorId.startsWith( '0|' ) ) {
        return editorId.split( '|', 2 )[ 1 ] || editorId;
    }
    if ( /^\d+$/.test( editorId ) ) {
        if ( typeof localization.formatUnknownUserId === 'function' ) {
            return localization.formatUnknownUserId( editorId );
        }
        return `User ID ${ editorId }`;
    }
    return editorId;
}

function mergeResolvedBytes( editorBytesByEditor, labelsByEditor, localization ) {
    const authorBytes = new Map();
    editorBytesByEditor.forEach( function ( byteCount, editorId ) {
        incrementMap(
            authorBytes,
            resolveEditorLabel( editorId, labelsByEditor, localization ),
            byteCount
        );
    } );
    return authorBytes;
}

function rankContributions( authorBytes ) {
    return Array.from( authorBytes.entries() ).sort( function ( a, b ) {
        if ( a[ 1 ] !== b[ 1 ] ) {
            return b[ 1 ] - a[ 1 ];
        }
        return a[ 0 ].localeCompare( b[ 0 ], undefined, {
            sensitivity: 'base'
        } );
    } );
}

function collapseForChart( rankedContributions, topSliceCount, localization ) {
    if ( topSliceCount <= 0 || rankedContributions.length <= topSliceCount ) {
        return rankedContributions.map( function ( item ) {
            return {
                label: item[ 0 ],
                bytes: item[ 1 ]
            };
        } );
    }

    const head = rankedContributions.slice( 0, topSliceCount ).map( function ( item ) {
        return {
            label: item[ 0 ],
            bytes: item[ 1 ]
        };
    } );
    const othersBytes = rankedContributions
        .slice( topSliceCount )
        .reduce( function ( sum, item ) {
            return sum + item[ 1 ];
        }, 0 );

    if ( othersBytes > 0 ) {
        head.push( {
            label: localization.othersLabel || 'Others',
            bytes: othersBytes
        } );
    }
    return head;
}

function buildView( authorBytes, topSliceCount, localization ) {
    const rankedContributions = rankContributions( authorBytes );
    const totalBytes = rankedContributions.reduce( function ( sum, item ) {
        return sum + item[ 1 ];
    }, 0 );
    return {
        totalBytes: totalBytes,
        contributorCount: rankedContributions.length,
        rankedContributions: rankedContributions.map( function ( item, index ) {
            return {
                rank: index + 1,
                label: item[ 0 ],
                bytes: item[ 1 ]
            };
        } ),
        chartContributions: collapseForChart( rankedContributions, topSliceCount, localization ),
        topSliceCount: topSliceCount
    };
}

export function getCurrentWikiId() {
    const hostParts = window.location.hostname.split( '.' );
    return hostParts[ 0 ] || 'zh';
}

export function normalizePageTitleForDisplay( pageName ) {
    return String( pageName || '' ).replace( /_/g, ' ' ).trim();
}

export async function fetchContributionViews( options ) {
    const api = options.api;
    const title = options.title;
    const wiki = options.wiki;
    const signal = options.signal;
    const topSliceCount = options.topSliceCount || DEFAULT_TOP_SLICES;
    const localization = options.localization || {};

    const latest = await fetchLatestRevisionData( title, wiki, signal );
    const revisionData = latest.revisionData;
    const tokens = Array.isArray( revisionData.tokens ) ? revisionData.tokens : [];

    if ( tokens.length === 0 ) {
        throw new Error( 'WikiWho returned no tokens for the latest revision' );
    }

    const editorByteMaps = computeEditorByteMaps( tokens );
    const editorIds = Array.from(
        new Set( [
            ...editorByteMaps.fullBytesByEditor.keys(),
            ...editorByteMaps.filteredBytesByEditor.keys()
        ] )
    );
    const labelsByEditor = await resolveEditorLabels( api, editorIds );

    return {
        articleTitle: latest.articleTitle,
        revisionId: latest.revisionId,
        wiki: wiki,
        includingCitations: buildView(
            mergeResolvedBytes(
                editorByteMaps.fullBytesByEditor,
                labelsByEditor,
                localization
            ),
            topSliceCount,
            localization
        ),
        excludingCitations: buildView(
            mergeResolvedBytes(
                editorByteMaps.filteredBytesByEditor,
                labelsByEditor,
                localization
            ),
            topSliceCount,
            localization
        )
    };
}
