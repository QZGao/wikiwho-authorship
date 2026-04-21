import {
    ArcElement,
    Chart,
    Legend,
    PieController,
    Tooltip
} from 'chart.js';

Chart.register( PieController, ArcElement, Tooltip, Legend );

export function createPieChartComponent( Vue ) {
    const {
        defineComponent,
        onBeforeUnmount,
        onMounted,
        ref,
        watch
    } = Vue;

    return defineComponent( {
        name: 'WikiWhoPieChart',
        props: {
            ariaLabel: {
                type: String,
                default: ''
            },
            chartData: {
                type: Object,
                required: true
            },
            chartOptions: {
                type: Object,
                default: function () {
                    return {};
                }
            }
        },
        template:
            '<div class="wwa-chart"><canvas ref="canvas" role="img" :aria-label="ariaLabel"></canvas></div>',
        setup: function ( props ) {
            const canvas = ref( null );
            let chart = null;

            function renderChart() {
                if ( !canvas.value ) {
                    return;
                }
                if ( chart ) {
                    chart.destroy();
                }
                chart = new Chart( canvas.value.getContext( '2d' ), {
                    type: 'pie',
                    data: props.chartData,
                    options: props.chartOptions
                } );
            }

            onMounted( renderChart );
            watch(
                function () {
                    return [ props.chartData, props.chartOptions ];
                },
                renderChart,
                {
                    deep: true
                }
            );
            onBeforeUnmount( function () {
                if ( chart ) {
                    chart.destroy();
                    chart = null;
                }
            } );

            return {
                canvas: canvas
            };
        }
    } );
}
