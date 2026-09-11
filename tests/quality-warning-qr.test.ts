import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QualityWarningPrintSheet} from '../components/QualityWarningPrintSheet';
import {qualityWarningQrKey,qualityWarningQrPath} from '../lib/quality-warning-qr';
import type {WorkOrderQualityWarningSnapshot} from '../lib/work-order-qr-service';

const warning = {alertId:'quick:same-drawing-warning',reportNo:'QQ-TEST',title:'结构异常',revisionNumber:1,severity:'LOW',archivedAt:'2026-09-11',employeePath:null,attachments:[]} as unknown as WorkOrderQualityWarningSnapshot;
const order={workOrderCode:'WO-ONE',productName:'连接线'};
const qr='data:image/png;base64,AA==';

test('old quick snapshots without employee links scan into the current order and preserve login mode',()=>{
  assert.equal(qualityWarningQrPath('order-one',warning),'/field-report/order-one?mode=report');
  assert.equal(qualityWarningQrPath('order/two',warning),'/field-report/order%2Ftwo?mode=report');
});
test('the same drawing warning printed on different orders has independent QR cache entries',()=>{
  const images=new Map([[qualityWarningQrKey('print-one',warning.alertId),qualityWarningQrPath('order-one',warning)],[qualityWarningQrKey('print-two',warning.alertId),qualityWarningQrPath('order-two',warning)]]);
  assert.equal(images.size,2);
  assert.equal(images.get(qualityWarningQrKey('print-one',warning.alertId)),'/field-report/order-one?mode=report');
  assert.equal(images.get(qualityWarningQrKey('print-two',warning.alertId)),'/field-report/order-two?mode=report');
});
test('every quick warning sheet renders a real QR image, including continuation pages',()=>{
  for(const pageNumber of [1,2]){
    const html=renderToStaticMarkup(React.createElement(QualityWarningPrintSheet,{order,warning,qrImage:qr,pageNumber,totalPages:2,page:{blocks:[]}}));
    assert.match(html,/<div class="quality-v2-qr"><img/);
    assert.ok(html.includes(qr));assert.ok(html.includes('扫码登录查看本工单质量异常'));
    assert.ok(!html.includes('使用流转单二维码登录查看'));
  }
});
test('major warning revision links and draft printing rules remain intact',()=>{
  const major={...warning,alertId:'major-alert',employeePath:'/quality-warning/signed-revision'};
  assert.equal(qualityWarningQrPath('order-one',major),major.employeePath);
  assert.equal(qualityWarningQrPath('order-one',{...major,employeePath:null}),null);
  const html=renderToStaticMarkup(React.createElement(QualityWarningPrintSheet,{order,warning:major,qrImage:qr,pageNumber:1,totalPages:1,previewState:'DRAFT',page:{blocks:[]}}));
  assert.ok(!html.includes(qr));assert.ok(html.includes('草稿无员工码'));
});
