/* 浏览器入口：index.html 以 <script type="module"> 引用本文件，
 * 全部模块求值完成后调用 boot()。测试管线不加载本文件，boot 不会被意外触发。
 */
import { boot } from './main.js';

boot();
