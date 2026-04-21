import {
    DEFAULT_TOP_SLICES,
    fetchContributionViews,
    getCurrentWikiId,
    normalizePageTitleForDisplay
} from './authorship.js';
import { createPieChartComponent } from './chart-component.js';

const CHART_COLORS = [
    '#36c',
    '#14866d',
    '#d33',
    '#fc3',
    '#6b4ba1',
    '#0a7caa',
    '#ff6f61',
    '#a66200',
    '#576f85',
    '#66a61e',
    '#cc79a7'
];
const numberFormatter = new Intl.NumberFormat( 'en-US' );
const percentFormatter = new Intl.NumberFormat( 'en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
} );
const state = {
    articleTitle: '',
    error: '',
    excludingCitations: null,
    hideCitations: true,
    includingCitations: null,
    latestRevisionId: '',
    loading: false,
    open: false,
    pageTitle: '',
    wiki: '',
    currentAbortController: null
};

let openDialogForPage = null;
let convByVar = fallbackConvByVar;
let sharedState = null;

function getState() {
    return sharedState || state;
}

function fallbackConvByVar( variants ) {
    return variants.en || variants.hant || variants.hans || '';
}

function t( variants ) {
    return convByVar( variants );
}

function tf( variants, replacements ) {
    let text = t( variants );
    Object.keys( replacements || {} ).forEach( function ( key ) {
        text = text.replace( new RegExp( `\\$${ key }`, 'g' ), replacements[ key ] );
    } );
    return text;
}

function getDefaultAction() {
    return {
        label: t( {
            en: 'Close',
            hans: '关闭',
            hant: '關閉'
        } )
    };
}

function getLocalizationOptions() {
    return {
        othersLabel: t( {
            en: 'Others',
            hans: '其他',
            hant: '其他'
        } ),
        formatUnknownUserId: function ( editorId ) {
            return tf(
                {
                    en: 'User ID $id',
                    hans: '用户 ID $id',
                    hant: '使用者 ID $id'
                },
                {
                    id: editorId
                }
            );
        }
    };
}

function getStaticTexts() {
    return {
        article: t( {
            en: 'Article',
            hans: '条目',
            hant: '條目'
        } ),
        authorship: t( {
            en: 'WikiWho authorship',
            hans: 'WikiWho作者归属',
            hant: 'WikiWho作者歸屬'
        } ),
        chart: t( {
            en: 'Chart',
            hans: '图表',
            hant: '圖表'
        } ),
        contributors: t( {
            en: 'Contributors',
            hans: '贡献者',
            hant: '貢獻者'
        } ),
        exclusions: t( {
            en: 'Exclusions',
            hans: '排除项',
            hant: '排除項'
        } ),
        currentViewEmpty: t( {
            en: 'No surviving bytes remain for this view.',
            hans: '当前视图下没有可显示的现存字节。',
            hant: '目前檢視下沒有可顯示的現存位元組。'
        } ),
        fetching: t( {
            en: 'Fetching authorship data…',
            hans: '正在获取作者归属数据……',
            hant: '正在取得作者歸屬資料……'
        } ),
        includeCitations: t( {
            en: 'Hide citations (<ref>, {{r}})',
            hans: '隐藏引用（<ref>、{{r}}）',
            hant: '隱藏引用（<ref>、{{r}}）'
        } ),
        latestRevision: t( {
            en: 'Latest revision',
            hans: '最新修订版本',
            hant: '最新修訂版本'
        } ),
        totalSurvivingBytes: t( {
            en: 'Total surviving bytes',
            hans: '现存字节总数',
            hant: '現存位元組總數'
        } )
    };
}

function formatNumber( value ) {
    return numberFormatter.format( value || 0 );
}

function formatPercent( value ) {
    return percentFormatter.format( value || 0 );
}

function ensureStyles() {
    if ( document.getElementById( 'wikiwho-authorship-styles' ) ) {
        return;
    }

    const styleTag = document.createElement( 'style' );
    styleTag.id = 'wikiwho-authorship-styles';
    styleTag.textContent = `
.wwa-dialog {
    max-width: 960px;
}
.wwa-body {
    display: grid;
    gap: 16px;
}
.wwa-status-grid {
    display: grid;
    gap: 8px 16px;
    grid-template-columns: repeat( auto-fit, minmax( 180px, 1fr ) );
}
.wwa-status-card {
    border: 1px solid #c8ccd1;
    border-radius: 4px;
    padding: 12px;
    background: #fff;
}
.wwa-status-label {
    display: block;
    color: #54595d;
    font-size: 12px;
    line-height: 1.4;
    margin-bottom: 4px;
}
.wwa-status-value {
    display: block;
    color: #202122;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.5;
    word-break: break-word;
}
.wwa-toggle {
    margin-top: 4px;
}
.wwa-state {
    border: 1px solid #c8ccd1;
    border-radius: 4px;
    padding: 12px;
    background: #f8f9fa;
    color: #202122;
}
.wwa-state--error {
    border-color: #d33;
    background: #fee7e6;
}
.wwa-chart-panel {
    border: 1px solid #c8ccd1;
    border-radius: 4px;
    padding: 12px;
    background: #fff;
}
.wwa-chart {
    height: 420px;
    position: relative;
}
.wwa-note {
    color: #54595d;
    font-size: 12px;
    line-height: 1.5;
}
`;
    document.head.appendChild( styleTag );
}

function buildChartData( view ) {
    return {
        labels: view.chartContributions.map( function ( item ) {
            return item.label;
        } ),
        datasets: [ {
            data: view.chartContributions.map( function ( item ) {
                return item.bytes;
            } ),
            backgroundColor: view.chartContributions.map( function ( _item, index ) {
                return CHART_COLORS[ index % CHART_COLORS.length ];
            } ),
            borderColor: '#fff',
            borderWidth: 1,
            hoverOffset: 8
        } ]
    };
}

function buildChartOptions( view ) {
    const totalBytes = view.totalBytes;
    const legendPosition =
        window.matchMedia && window.matchMedia( '(min-width: 1000px)' ).matches
            ? 'right'
            : 'bottom';

    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 180
        },
        plugins: {
            legend: {
                position: legendPosition,
                labels: {
                    boxWidth: 14,
                    padding: 12,
                    usePointStyle: true,
                    color: '#202122',
                    font: {
                        size: 12
                    }
                }
            },
            tooltip: {
                callbacks: {
                    label: function ( context ) {
                        const value = Number( context.raw ) || 0;
                        const ratio = totalBytes > 0 ? value / totalBytes : 0;
                        return tf(
                            {
                                en: '$label: $bytes bytes ($percent)',
                                hans: '$label：$bytes 字节（$percent）',
                                hant: '$label：$bytes 位元組（$percent）'
                            },
                            {
                                label: context.label,
                                bytes: formatNumber( value ),
                                percent: formatPercent( ratio )
                            }
                        );
                    }
                }
            }
        }
    };
}

function abortActiveRequest() {
    const currentState = getState();
    if ( currentState.currentAbortController ) {
        currentState.currentAbortController.abort();
        currentState.currentAbortController = null;
    }
    currentState.loading = false;
}

function shouldEnableScript() {
    return Boolean(
        mw.config.get( 'wgRelevantPageName' ) &&
        mw.config.get( 'wgPageContentModel' ) === 'wikitext' &&
        mw.config.get( 'wgNamespaceNumber' ) >= 0
    );
}

function addPortletLink() {
    const label = t( {
        en: 'WikiWho authorship',
        hans: 'WikiWho作者归属',
        hant: 'WikiWho作者歸屬'
    } );
    const tooltip = t( {
        en: 'Show a WikiWho authorship pie chart',
        hans: '显示 WikiWho 作者归属饼图',
        hant: '顯示 WikiWho 作者歸屬圓餅圖'
    } );
    const node =
        mw.util.addPortletLink(
            'p-cactions',
            '#',
            label,
            'ca-wikiwho-authorship',
            tooltip
        ) ||
        mw.util.addPortletLink(
            'p-tb',
            '#',
            label,
            't-wikiwho-authorship',
            tooltip
        );

    if ( !node ) {
        return;
    }

    node.addEventListener( 'click', function ( event ) {
        event.preventDefault();

        const pageName = mw.config.get( 'wgRelevantPageName' ) || mw.config.get( 'wgPageName' );
        if ( !pageName ) {
            mw.notify( t( {
                en: 'No page title was found for the current view.',
                hans: '当前视图找不到页面标题。',
                hant: '目前檢視找不到頁面標題。'
            } ), {
                type: 'error'
            } );
            return;
        }

        openDialogForPage( pageName );
    } );
}

function createRootComponent( Vue ) {
    const {
        computed,
        defineComponent,
        reactive,
        watch
    } = Vue;

    const reactiveState = sharedState || reactive( state );
    sharedState = reactiveState;

    return defineComponent( {
        name: 'WikiWhoAuthorshipRoot',
        setup: function () {
            const texts = getStaticTexts();
            const currentView = computed( function () {
                return reactiveState.hideCitations
                    ? reactiveState.excludingCitations
                    : reactiveState.includingCitations;
            } );
            const chartData = computed( function () {
                return currentView.value ? buildChartData( currentView.value ) : null;
            } );
            const chartOptions = computed( function () {
                return currentView.value ? buildChartOptions( currentView.value ) : null;
            } );
            const chartHasData = computed( function () {
                return Boolean(
                    currentView.value &&
                    currentView.value.chartContributions &&
                    currentView.value.chartContributions.length
                );
            } );
            const dialogTitle = computed( function () {
                const displayTitle =
                    reactiveState.articleTitle ||
                    normalizePageTitleForDisplay( reactiveState.pageTitle );
                return displayTitle
                    ? tf(
                        {
                            en: 'WikiWho authorship: $title',
                            hans: 'WikiWho作者归属：$title',
                            hant: 'WikiWho作者歸屬：$title'
                        },
                        {
                            title: displayTitle
                        }
                    )
                    : texts.authorship;
            } );
            const exclusionsLabel = computed( function () {
                return reactiveState.hideCitations
                    ? t( {
                        en: '<ref>...</ref>, <ref .../>, and {{r...}}',
                        hans: '<ref>...</ref>、<ref .../> 和 {{r...}}',
                        hant: '<ref>...</ref>、<ref .../> 和 {{r...}}'
                    } )
                    : t( {
                        en: 'none',
                        hans: '无',
                        hant: '無'
                    } );
            } );
            const chartModeLabel = computed( function () {
                if ( !currentView.value ) {
                    return '—';
                }
                if ( currentView.value.contributorCount > DEFAULT_TOP_SLICES ) {
                    return tf(
                        {
                            en: 'Top $count + Others',
                            hans: '前 $count 名 + 其他',
                            hant: '前 $count 名 + 其他'
                        },
                        {
                            count: String( DEFAULT_TOP_SLICES )
                        }
                    );
                }
                return tf(
                    {
                        en: '$count slices',
                        hans: '$count 个扇区',
                        hant: '$count 個扇區'
                    },
                    {
                        count: formatNumber( currentView.value.contributorCount )
                    }
                );
            } );
            const chartAriaLabel = computed( function () {
                if ( !currentView.value ) {
                    return t( {
                        en: 'WikiWho authorship pie chart',
                        hans: 'WikiWho作者归属饼图',
                        hant: 'WikiWho作者歸屬圓餅圖'
                    } );
                }
                const detail = currentView.value.chartContributions
                    .map( function ( item ) {
                        const ratio =
                            currentView.value.totalBytes > 0
                                ? item.bytes / currentView.value.totalBytes
                                : 0;
                        return tf(
                            {
                                en: '$label: $bytes bytes ($percent)',
                                hans: '$label：$bytes 字节（$percent）',
                                hant: '$label：$bytes 位元組（$percent）'
                            },
                            {
                                label: item.label,
                                bytes: formatNumber( item.bytes ),
                                percent: formatPercent( ratio )
                            }
                        );
                    } )
                    .join( '; ' );
                return `${ dialogTitle.value }. ${ detail }`;
            } );

            function closeDialog() {
                reactiveState.open = false;
            }

            watch(
                function () {
                    return reactiveState.open;
                },
                function ( isOpen ) {
                    if ( !isOpen ) {
                        abortActiveRequest();
                    }
                }
            );

            return {
                chartAriaLabel: chartAriaLabel,
                chartData: chartData,
                chartHasData: chartHasData,
                chartModeLabel: chartModeLabel,
                chartOptions: chartOptions,
                closeDialog: closeDialog,
                currentView: currentView,
                defaultAction: getDefaultAction(),
                dialogTitle: dialogTitle,
                exclusionsLabel: exclusionsLabel,
                formatNumber: formatNumber,
                texts: texts,
                state: reactiveState
            };
        },
        template: `
<cdx-dialog
    v-model:open="state.open"
    class="wwa-dialog"
    :title="dialogTitle"
    :use-close-button="true"
    :default-action="defaultAction"
    @default="closeDialog"
>
    <div class="wwa-body">
        <div class="wwa-status-grid" aria-live="polite">
            <div class="wwa-status-card">
                <span class="wwa-status-label">{{ texts.article }}</span>
                <span class="wwa-status-value">{{ state.articleTitle || '—' }}</span>
            </div>
            <div class="wwa-status-card">
                <span class="wwa-status-label">{{ texts.latestRevision }}</span>
                <span class="wwa-status-value">{{ state.latestRevisionId || '—' }}</span>
            </div>
            <div class="wwa-status-card">
                <span class="wwa-status-label">{{ texts.totalSurvivingBytes }}</span>
                <span class="wwa-status-value">{{ currentView ? formatNumber( currentView.totalBytes ) : '—' }}</span>
            </div>
            <div class="wwa-status-card">
                <span class="wwa-status-label">{{ texts.contributors }}</span>
                <span class="wwa-status-value">{{ currentView ? formatNumber( currentView.contributorCount ) : '—' }}</span>
            </div>
        </div>

        <div v-if="state.loading" class="wwa-state" role="status">
            {{ texts.fetching }}
        </div>

        <div v-else-if="state.error" class="wwa-state wwa-state--error" role="alert">
            {{ state.error }}
        </div>

        <template v-else-if="currentView">
            <cdx-checkbox v-model="state.hideCitations" class="wwa-toggle">
                {{ texts.includeCitations }}
            </cdx-checkbox>

            <div class="wwa-chart-panel">
                <pie-chart
                    v-if="chartHasData && chartData && chartOptions"
                    :chart-data="chartData"
                    :chart-options="chartOptions"
                    :aria-label="chartAriaLabel"
                />
                <div v-else class="wwa-state">
                    {{ texts.currentViewEmpty }}
                </div>
            </div>
        </template>
    </div>
</cdx-dialog>
`
    } );
}

async function fetchAndPopulateState( api, pageName ) {
    abortActiveRequest();

    const currentState = getState();
    const controller = new AbortController();
    currentState.currentAbortController = controller;
    currentState.loading = true;
    currentState.error = '';
    currentState.articleTitle = '';
    currentState.latestRevisionId = '';
    currentState.includingCitations = null;
    currentState.excludingCitations = null;
    currentState.hideCitations = true;
    currentState.pageTitle = pageName;
    currentState.wiki = getCurrentWikiId();

    try {
        const result = await fetchContributionViews( {
            api: api,
            localization: getLocalizationOptions(),
            signal: controller.signal,
            title: normalizePageTitleForDisplay( pageName ),
            topSliceCount: DEFAULT_TOP_SLICES,
            wiki: currentState.wiki
        } );

        if ( controller.signal.aborted || currentState.currentAbortController !== controller ) {
            return;
        }

        currentState.articleTitle = result.articleTitle || normalizePageTitleForDisplay( pageName );
        currentState.latestRevisionId = result.revisionId;
        currentState.includingCitations = result.includingCitations;
        currentState.excludingCitations = result.excludingCitations;
    } catch ( error ) {
        if (
            ( error && error.name === 'AbortError' ) ||
            currentState.currentAbortController !== controller
        ) {
            return;
        }
        currentState.error = error && error.message ? error.message : String( error );
    } finally {
        if ( currentState.currentAbortController === controller ) {
            currentState.currentAbortController = null;
            currentState.loading = false;
        }
    }
}

mw.loader
    .using(
        [ 'mediawiki.api', 'mediawiki.util', '@wikimedia/codex' ].concat(
            mw.loader.getState( 'ext.gadget.HanAssist' ) &&
            mw.loader.getState( 'ext.gadget.HanAssist' ) !== 'missing' &&
            mw.loader.getState( 'ext.gadget.HanAssist' ) !== 'error'
                ? [ 'ext.gadget.HanAssist' ]
                : []
        )
    )
    .then( function ( require ) {
        const Vue = require( 'vue' );
        const Codex = require( '@wikimedia/codex' );
        const PieChart = createPieChartComponent( Vue );
        const Root = createRootComponent( Vue );
        const api = new mw.Api();
        const mountPoint = document.body.appendChild( document.createElement( 'div' ) );

        if ( typeof require === 'function' ) {
            try {
                convByVar = require( 'ext.gadget.HanAssist' ).convByVar || convByVar;
            } catch ( error ) {
                convByVar = convByVar;
            }
        }

        ensureStyles();

        openDialogForPage = function ( pageName ) {
            getState().open = true;
            fetchAndPopulateState( api, pageName );
        };

        const app = Vue.createMwApp( Root );
        app.component( 'CdxCheckbox', Codex.CdxCheckbox );
        app.component( 'CdxDialog', Codex.CdxDialog );
        app.component( 'PieChart', PieChart );
        app.mount( mountPoint );

        if ( shouldEnableScript() ) {
            addPortletLink();
        }
    } );
