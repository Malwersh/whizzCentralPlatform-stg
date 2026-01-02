#!/usr/bin/env node

/**
 * Wave System Results Analyzer
 * 
 * أداة تحليل متقدمة لنتائج المحاكاة مع رسوم بيانية نصية
 */

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

// =====================================
// رسم رسم بياني نصي للنقاط
// =====================================
function drawBarChart(label, value, maxValue, width = 40) {
  const barLength = Math.round((value / maxValue) * width);
  const bar = '█'.repeat(barLength) + '░'.repeat(width - barLength);
  const percentage = ((value / maxValue) * 100).toFixed(0);
  return `${label.padEnd(20)} ${bar} ${value.toFixed(1)}/${maxValue} (${percentage}%)`;
}

// =====================================
// تحليل توزيع النقاط
// =====================================
function analyzeScoreDistribution(drivers) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 تحليل توزيع النقاط');
  console.log('='.repeat(80) + '\n');

  drivers.forEach((driver, index) => {
    console.log(`🏅 ${index + 1}. ${driver.name}`);
    console.log(`   ${drawBarChart('المنطقة', driver.scores.region, 25)}`);
    console.log(`   ${drawBarChart('المسافة', driver.scores.distance, 30)}`);
    console.log(`   ${drawBarChart('الأداء', driver.scores.performance, 45)}`);
    console.log(`   ${drawBarChart('المجموع', driver.scores.total, 100)}`);
    console.log('');
  });
}

// =====================================
// مقارنة السيناريوهات
// =====================================
function compareScenarios(drivers) {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 مقارنة السيناريوهات');
  console.log('='.repeat(80) + '\n');

  // أقرب سائق
  const closest = drivers.reduce((prev, curr) => 
    curr.distance < prev.distance ? curr : prev
  );
  console.log(`📍 أقرب سائق: ${closest.name} (${closest.distance.toFixed(2)} كم)`);
  console.log(`   ترتيبه: #${drivers.indexOf(closest) + 1}`);
  console.log(`   نقاطه: ${closest.scores.total.toFixed(1)}`);

  // أبعد سائق
  const farthest = drivers.reduce((prev, curr) => 
    curr.distance > prev.distance ? curr : prev
  );
  console.log(`\n📍 أبعد سائق: ${farthest.name} (${farthest.distance.toFixed(2)} كم)`);
  console.log(`   ترتيبه: #${drivers.indexOf(farthest) + 1}`);
  console.log(`   نقاطه: ${farthest.scores.total.toFixed(1)}`);

  // أفضل أداء
  const bestPerformance = drivers.reduce((prev, curr) => 
    curr.scores.performance > prev.scores.performance ? curr : prev
  );
  console.log(`\n⭐ أفضل أداء: ${bestPerformance.name}`);
  console.log(`   نقاط الأداء: ${bestPerformance.scores.performance.toFixed(1)}/45`);
  console.log(`   ترتيبه: #${drivers.indexOf(bestPerformance) + 1}`);

  // في المنطقة الأساسية
  const homeRegionDrivers = drivers.filter(d => d.scores.region === 25);
  console.log(`\n🏠 سائقون في المنطقة الأساسية: ${homeRegionDrivers.length}`);
  homeRegionDrivers.forEach((d, i) => {
    console.log(`   ${i + 1}. ${d.name} - ترتيب: #${drivers.indexOf(d) + 1}`);
  });

  // Priority 1
  const priority1Drivers = drivers.filter(d => d.scores.region === 10);
  console.log(`\n🔄 سائقون Priority 1: ${priority1Drivers.length}`);
  priority1Drivers.forEach((d, i) => {
    console.log(`   ${i + 1}. ${d.name} - ترتيب: #${drivers.indexOf(d) + 1}`);
  });
}

// =====================================
// تحليل تأثير المعايير
// =====================================
function analyzeCriteriaImpact(drivers) {
  console.log('\n' + '='.repeat(80));
  console.log('🎯 تحليل تأثير المعايير على الترتيب');
  console.log('='.repeat(80) + '\n');

  // متوسط النقاط لكل معيار
  const avgRegion = drivers.reduce((sum, d) => sum + d.scores.region, 0) / drivers.length;
  const avgDistance = drivers.reduce((sum, d) => sum + d.scores.distance, 0) / drivers.length;
  const avgPerformance = drivers.reduce((sum, d) => sum + d.scores.performance, 0) / drivers.length;

  console.log('📈 متوسط النقاط:');
  console.log(`   ${drawBarChart('المنطقة', avgRegion, 25)}`);
  console.log(`   ${drawBarChart('المسافة', avgDistance, 30)}`);
  console.log(`   ${drawBarChart('الأداء', avgPerformance, 45)}`);

  // الفائز vs الأخير
  const winner = drivers[0];
  const last = drivers[drivers.length - 1];

  console.log('\n🥇 الفائز vs 🥉 الأخير:');
  console.log(`\n   ${winner.name}:`);
  console.log(`   ├─ المنطقة: ${winner.scores.region.toFixed(1)} (+${(winner.scores.region - last.scores.region).toFixed(1)})`);
  console.log(`   ├─ المسافة: ${winner.scores.distance.toFixed(1)} (+${(winner.scores.distance - last.scores.distance).toFixed(1)})`);
  console.log(`   ├─ الأداء: ${winner.scores.performance.toFixed(1)} (+${(winner.scores.performance - last.scores.performance).toFixed(1)})`);
  console.log(`   └─ المجموع: ${winner.scores.total.toFixed(1)} (+${(winner.scores.total - last.scores.total).toFixed(1)})`);

  console.log(`\n   ${last.name}:`);
  console.log(`   ├─ المنطقة: ${last.scores.region.toFixed(1)}`);
  console.log(`   ├─ المسافة: ${last.scores.distance.toFixed(1)}`);
  console.log(`   ├─ الأداء: ${last.scores.performance.toFixed(1)}`);
  console.log(`   └─ المجموع: ${last.scores.total.toFixed(1)}`);

  // المعيار الأكثر تأثيراً
  console.log('\n💡 الملاحظات:');
  
  if (winner.scores.region > last.scores.region + 10) {
    console.log('   ✅ المنطقة لها تأثير كبير على الفوز');
  }
  
  if (winner.scores.distance > last.scores.distance + 10) {
    console.log('   ✅ المسافة لها تأثير كبير على الفوز');
  }
  
  if (winner.scores.performance > last.scores.performance + 10) {
    console.log('   ✅ الأداء له تأثير كبير على الفوز');
  }

  if (winner.distance < 1 && winner.scores.region === 25) {
    console.log('   🎯 الفائز يجمع بين القرب والمنطقة الأساسية');
  }
}

// =====================================
// محاكاة "ماذا لو"
// =====================================
function whatIfAnalysis(drivers) {
  console.log('\n' + '='.repeat(80));
  console.log('🔮 تحليل "ماذا لو" - سيناريوهات افتراضية');
  console.log('='.repeat(80) + '\n');

  const winner = drivers[0];

  // ماذا لو كان البعيد أقرب؟
  console.log('❓ ماذا لو كان السائق البعيد (15 كم) أقرب (5 كم)؟');
  const farDriver = drivers.find(d => d.distance > 10);
  if (farDriver) {
    const newDistanceScore = 30 * (1 - (5 / 20));
    const newTotal = farDriver.scores.region + newDistanceScore + farDriver.scores.performance;
    console.log(`   السائق: ${farDriver.name}`);
    console.log(`   النقاط الحالية: ${farDriver.scores.total.toFixed(1)}`);
    console.log(`   النقاط الجديدة: ${newTotal.toFixed(1)}`);
    console.log(`   ${newTotal > winner.scores.total ? '🏆 سيفوز!' : '❌ لن يفوز بعد'}`);
  }

  // ماذا لو تحسّن أداء السائق الضعيف؟
  console.log('\n❓ ماذا لو تحسّن أداء السائق ضعيف الأداء؟');
  console.log('   (لو حصل على: Acceptance 90%, Completion 95%, Rating 4.5)');
  const newPerformanceScore = (0.9 * 20) + (0.95 * 20) + (0.5 * 5);
  console.log(`   نقاط الأداء الجديدة: ${newPerformanceScore.toFixed(1)}/45`);
  console.log('   ✅ سيُقبل في المنافسة!');

  // ماذا لو كان السائق في منطقة Priority 0 بدلاً من Priority 1؟
  const priority1Driver = drivers.find(d => d.scores.region === 10);
  if (priority1Driver) {
    console.log('\n❓ ماذا لو كان السائق Priority 1 في Priority 0؟');
    const newTotal = 20 + priority1Driver.scores.distance + priority1Driver.scores.performance;
    console.log(`   السائق: ${priority1Driver.name}`);
    console.log(`   النقاط الحالية: ${priority1Driver.scores.total.toFixed(1)}`);
    console.log(`   النقاط الجديدة: ${newTotal.toFixed(1)} (+${(newTotal - priority1Driver.scores.total).toFixed(1)})`);
  }
}

// =====================================
// إحصائيات الفلترة
// =====================================
function filteringStats(allDrivers, availableDrivers, withinRange, performancePassed, selected) {
  console.log('\n' + '='.repeat(80));
  console.log('📉 إحصائيات مراحل الفلترة');
  console.log('='.repeat(80) + '\n');

  const stages = [
    { name: 'السائقين الأوليين', count: allDrivers, icon: '👥' },
    { name: 'متصلين ومتاحين', count: availableDrivers, icon: '✅' },
    { name: 'ضمن النطاق (20 كم)', count: withinRange, icon: '📍' },
    { name: 'يحققون معايير الأداء', count: performancePassed, icon: '⭐' },
    { name: 'المختارين للموجة', count: selected, icon: '🏆' }
  ];

  stages.forEach((stage, index) => {
    const prevCount = index > 0 ? stages[index - 1].count : stage.count;
    const rejected = prevCount - stage.count;
    const percentage = prevCount > 0 ? ((stage.count / prevCount) * 100).toFixed(0) : 100;
    
    console.log(`${stage.icon} ${stage.name}: ${stage.count}`);
    if (rejected > 0) {
      console.log(`   └─ رُفض: ${rejected} (${(100 - percentage)}%)`);
    }
  });

  const finalPercentage = ((selected / allDrivers) * 100).toFixed(0);
  console.log(`\n📊 معدل القبول الإجمالي: ${finalPercentage}% (${selected}/${allDrivers})`);
}

// =====================================
// توصيات تحسين النظام
// =====================================
function systemRecommendations(drivers) {
  console.log('\n' + '='.repeat(80));
  console.log('💡 توصيات تحسين النظام');
  console.log('='.repeat(80) + '\n');

  // فحص توزيع النقاط
  const regionScores = drivers.map(d => d.scores.region);
  const uniqueRegionScores = [...new Set(regionScores)];
  
  if (uniqueRegionScores.length === 1) {
    console.log('⚠️  جميع السائقين من نفس مستوى المنطقة');
    console.log('   💡 التوصية: اختبر سيناريوهات مع مناطق مختلفة');
  }

  // فحص المسافات
  const avgDistance = drivers.reduce((sum, d) => sum + d.distance, 0) / drivers.length;
  if (avgDistance < 2) {
    console.log('\n✅ جميع السائقين قريبون جداً (< 2 كم)');
    console.log('   💡 هذا مثالي لأوقات التوصيل السريعة');
  }

  // فحص الأداء
  const lowPerformanceCount = drivers.filter(d => d.scores.performance < 30).length;
  if (lowPerformanceCount > 0) {
    console.log(`\n⚠️  ${lowPerformanceCount} سائق بأداء منخفض (< 30 نقطة)`);
    console.log('   💡 التوصية: مراجعة معايير الأداء أو تدريب السائقين');
  }

  // السائقين الجدد
  const newDrivers = drivers.filter(d => d.metricsSnapshot_totalTrips < 5);
  if (newDrivers.length > 0) {
    console.log(`\n🆕 ${newDrivers.length} سائق جديد في القائمة`);
    console.log('   💡 راقب أداءهم في الرحلات الأولى');
  }

  // توازن المعايير
  const avgRegionPct = (drivers.reduce((sum, d) => sum + d.scores.region, 0) / drivers.length / 25) * 100;
  const avgDistancePct = (drivers.reduce((sum, d) => sum + d.scores.distance, 0) / drivers.length / 30) * 100;
  const avgPerformancePct = (drivers.reduce((sum, d) => sum + d.scores.performance, 0) / drivers.length / 45) * 100;

  console.log('\n📊 توازن تأثير المعايير:');
  console.log(`   المنطقة: ${avgRegionPct.toFixed(0)}% من الحد الأقصى`);
  console.log(`   المسافة: ${avgDistancePct.toFixed(0)}% من الحد الأقصى`);
  console.log(`   الأداء: ${avgPerformancePct.toFixed(0)}% من الحد الأقصى`);

  if (Math.abs(avgRegionPct - avgDistancePct) > 30 || Math.abs(avgRegionPct - avgPerformancePct) > 30) {
    console.log('\n   ⚠️  عدم توازن في تأثير المعايير');
    console.log('   💡 قد تحتاج لضبط الأوزان (25-30-45)');
  } else {
    console.log('\n   ✅ المعايير متوازنة بشكل جيد');
  }
}

// =====================================
// التشغيل الرئيسي
// =====================================
function runAnalysis() {
  // استيراد البيانات من السكريبت الأصلي
  const DRIVER_SCENARIOS = require('./wave-simulator.js').DRIVER_SCENARIOS || [];
  const MOCK_ORDER = require('./wave-simulator.js').MOCK_ORDER || {};
  
  console.log('\n🔍 تحليل متقدم لنتائج Wave System Simulator\n');
  
  // هنا يمكن إضافة المنطق لتحليل البيانات الفعلية
  console.log('💡 لتشغيل التحليل الكامل، شغّل المحاكاة أولاً:\n');
  console.log('   node wave-simulator.js simulate > results.txt');
  console.log('   node wave-analyzer.js analyze results.txt\n');
}

// للاستخدام المستقبلي
module.exports = {
  analyzeScoreDistribution,
  compareScenarios,
  analyzeCriteriaImpact,
  whatIfAnalysis,
  filteringStats,
  systemRecommendations,
  drawBarChart
};

if (require.main === module) {
  runAnalysis();
}
