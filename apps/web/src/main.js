/**
 * 应用入口。
 *
 * 关键点：必须在任何 Cesium 代码之前设置 window.CESIUM_BASE_URL，
 * 否则 Cesium 会去默认（CDN/相对）路径找 Workers 与 Assets。
 */
window.CESIUM_BASE_URL = '/cesium/'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import 'cesium/Build/Cesium/Widgets/widgets.css'
import './styles/main.css'

createApp(App).use(createPinia()).mount('#app')
