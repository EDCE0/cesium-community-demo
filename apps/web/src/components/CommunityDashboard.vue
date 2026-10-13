<script setup>
import { computed } from 'vue'
import EChartBox from './EChartBox.vue'
const props = defineProps({ scene: { type: Object, required: true } })
const emit = defineEmits(['quick', 'locate', 'panel'])
const stats = computed(() => props.scene.statistics)
const abnormal = computed(() => props.scene.iotAbnormal.length)
const latest = (metric) => props.scene.timeseries?.community?.[metric]?.at(-1) ?? '—'
const reading = (type) => props.scene.iotReadings.find(r => r.type === type)
const trend = computed(() => ({
  color: ['#20e4db', '#50b9ff'], backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' }, legend: { data: ['用水', '用气'], textStyle: { color: '#a1ccd9', fontSize: 10 }, top: 0 },
  grid: { left: 32, right: 10, top: 30, bottom: 22 },
  xAxis: { type: 'category', data: props.scene.timeseries?.labels ?? [], axisLabel: { color: '#84aabb', fontSize: 9 }, axisLine: { lineStyle: { color: '#254d61' } } },
  yAxis: { type: 'value', axisLabel: { color: '#84aabb', fontSize: 9 }, splitLine: { lineStyle: { color: '#1a3c4d' } } },
  series: ['water', 'gas'].map((m, i) => ({ name: ['用水', '用气'][i], type: 'line', smooth: true, symbolSize: 4, data: props.scene.timeseries?.community?.[m] ?? [], areaStyle: { opacity: .09 } }))
}))
const energy = computed(() => ({
  color: ['#26daca'], tooltip: { trigger: 'axis' }, grid: { left: 38, right: 8, top: 12, bottom: 24 },
  xAxis: { type: 'category', data: props.scene.timeseries?.labels ?? [], axisLabel: { color: '#84aabb', fontSize: 9 } },
  yAxis: { type: 'value', axisLabel: { color: '#84aabb', fontSize: 9 }, splitLine: { lineStyle: { color: '#1a3c4d' } } },
  series: [{ type: 'bar', barWidth: '40%', data: props.scene.timeseries?.community?.power ?? [], itemStyle: { borderRadius: [2, 2, 0, 0] } }]
}))
const alarmCount = computed(() => props.scene.alarms.filter(a => a.status === '处理中').length)
</script>
<template>
  <div class="community-hud">
    <nav class="system-nav" aria-label="业务导航">
      <button class="active" @click="emit('quick','overview')">社区总览</button>
      <button @click="emit('quick','underground')">地下管网</button>
      <button @click="emit('panel','layers')">楼栋管理</button>
      <span class="nav-spacer"></span>
      <button @click="emit('quick','stats')">能耗分析</button>
      <button @click="emit('panel','alarms')">安全监测</button>
      <button @click="emit('panel','chat')">智能助手</button>
    </nav>
    <div class="scene-metrics">
      <div><span>在线监测设备</span><b>{{ stats.sensors - abnormal }}<small> / {{ stats.sensors }}</small></b><em>ONLINE DEVICES</em></div>
      <div><span>待处理事件</span><b class="amber">{{ alarmCount }}<small> 件</small></b><em>ACTIVE EVENTS</em></div>
      <div><span>社区入住率</span><b>{{ (stats.occupancyRate * 100).toFixed(1) }}<small> %</small></b><em>OCCUPANCY RATE</em></div>
    </div>
    <aside class="hud-column hud-left">
      <section class="hud-card"><h2>社区运行概况 <small>OVERVIEW</small></h2>
        <div class="overview-grid"><div class="ring-stat"><b>{{ stats.residential }}</b><span>住宅楼栋</span></div><div class="ring-stat blue"><b>{{ props.scene.site?.households ?? '—' }}</b><span>住宅户数</span></div></div>
        <div class="mini-grid"><div><span>社区面积</span><b>{{ stats.area }}<small> km²</small></b></div><div><span>绿化覆盖率</span><b>{{ (stats.greenRate * 100).toFixed(0) }}<small> %</small></b></div></div>
      </section>
      <section class="hud-card"><h2>供水与燃气趋势 <small>8 DAYS</small></h2><EChartBox :option="trend" height="145px" /></section>
      <section class="hud-card"><h2>管网实时监测 <small>LIVE</small></h2><div class="mini-grid"><div><span>给水压力</span><b>{{ reading('pressure')?.value ?? '—' }}<small> MPa</small></b></div><div><span>燃气浓度</span><b>{{ reading('gas')?.value ?? '—' }}<small> %LEL</small></b></div><div><span>地下管线</span><b>{{ (stats.pipeLength / 1000).toFixed(2) }}<small> km</small></b></div><div><span>异常测点</span><b :class="{ amber: abnormal }">{{ abnormal }}<small> 个</small></b></div></div></section>
      <section class="hud-card"><h2>社区用电统计 <small>kWh / DAY</small></h2><EChartBox :option="energy" height="128px" /></section>
    </aside>
    <aside class="hud-column hud-right">
      <section class="hud-card"><h2>三维场景监测 <small>SCENE</small></h2><div class="scene-monitor"><span class="live-dot">● 场景同步</span><div class="radar"><i></i><b>◈</b></div><span>{{ props.scene.site?.name ?? '阳光新城' }} · {{ props.scene.underground ? '地下管网视图' : '地表建筑视图' }}</span></div></section>
      <section class="hud-card"><h2>安全事件记录 <button @click="emit('panel','alarms')">查看全部 ↗</button></h2><div class="event-list"><button v-for="a in props.scene.alarms.slice(0,4)" :key="a.id" @click="emit('locate',a.target)"><span>{{ a.ts.slice(11,16) }}</span><strong>{{ a.targetName }}</strong><em :class="{ amber: a.status === '处理中' }">{{ a.status }}</em></button></div></section>
      <section class="hud-card"><h2>资源消耗 <small>LATEST DAY</small></h2><div class="mini-grid"><div><span>社区用水</span><b>{{ latest('water') }}<small> m³</small></b></div><div><span>社区用气</span><b>{{ latest('gas') }}<small> m³</small></b></div><div><span>社区用电</span><b>{{ latest('power') }}<small> kWh</small></b></div><div><span>公共建筑</span><b>{{ stats.buildings - stats.residential }}<small> 栋</small></b></div></div></section>
      <section class="hud-card"><h2>设备总览 <small>INVENTORY</small></h2><div class="device-list"><div v-for="[type,label] in [['pressure','压力监测'],['gas','燃气探测'],['flow','流量监测'],['power','配电监测']]" :key="type"><span>◈ {{ label }}</span><b>{{ props.scene.sensors.filter(s=>s.type===type).length }} <small>个</small></b></div></div></section>
    </aside>
    <div class="scene-caption"><span class="live-dot">● 数字孪生场景</span><span>拖动旋转 · 滚轮缩放 · 点击楼栋查看详情</span></div>
    <span class="demo-label">程序化生成小区 · 业务数据为模拟演示</span>
  </div>
</template>
