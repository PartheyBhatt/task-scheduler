import Vue from 'vue';
import Index from './Index.vue';

/* eslint-disable no-undef */
if (typeof module.hot !== 'undefined') {
  module.hot.accept();
}
/* eslint-enable no-undef */

new Vue({
  el: '#root',
  render: (h) => h(Index),
});