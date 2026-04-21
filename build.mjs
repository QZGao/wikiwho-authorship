import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const packageJson = JSON.parse(
    readFileSync( resolve( 'package.json' ), 'utf8' )
);

const banner = `// WikiWho Authorship - Bundled Version
// Maintainer: SuperGrey
// Repository: https://github.com/QZGao/wikiwho-authorship
// Release: ${ packageJson.version }
// Timestamp: ${ new Date().toISOString() }
`;

function minifyCss( css ) {
    return css
        .replace( /\/\*[\s\S]*?\*\//g, '' )
        .replace( /\s+/g, ' ' )
        .replace( /\s*([(),])\s*/g, '$1' )
        .replace( /\s*([+~])\s*/g, '$1' )
        .replace( /\s*([{}:;,>])\s*/g, '$1' )
        .replace( /;}/g, '}' )
        .trim();
}

function minifyVueTemplate( template ) {
    return template
        .replace( />\s+</g, '><' )
        .replace( /\s+/g, ' ' )
        .replace( /\s*(\/?>)\s*/g, '$1' )
        .trim();
}

function minifyEmbeddedLiterals( source ) {
    return source
        .replace(
            /(\.textContent\s*=\s*`)([\s\S]*?)(`;\s*)/g,
            function ( match, prefix, content, suffix ) {
                if ( content.includes( '${' ) ) {
                    return match;
                }
                return `${ prefix }${ minifyCss( content ) }${ suffix }`;
            }
        )
        .replace(
            /(template:\s*`)([\s\S]*?)(`)/g,
            function ( match, prefix, content, suffix ) {
                if ( content.includes( '${' ) ) {
                    return match;
                }
                return `${ prefix }${ minifyVueTemplate( content ) }${ suffix }`;
            }
        );
}

const inlineLiteralMinifier = {
    name: 'inline-literal-minifier',
    setup( buildContext ) {
        buildContext.onLoad(
            {
                filter: /src[\\/].+\.js$/
            },
            async function ( args ) {
                return {
                    contents: minifyEmbeddedLiterals(
                        readFileSync( args.path, 'utf8' )
                    ),
                    loader: 'js'
                };
            }
        );
    }
};

await build( {
    entryPoints: [ 'src/index.js' ],
    outfile: 'dist/Gadget-WikiWho-Authorship.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: [ 'es2019' ],
    minify: true,
    legalComments: 'eof',
    plugins: [ inlineLiteralMinifier ],
    banner: {
        js: banner
    }
} );
