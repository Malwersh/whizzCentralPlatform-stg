(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampaignFundingDisclosure = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function describe(offer, editing = false) {
    const delivery = ['freeDelivery', 'free_delivery', 'free-delivery'].includes(offer.type);
    const merchant = offer.source === 'merchant';
    const known = merchant || ['campaign', 'platform'].includes(offer.source);
    const payer = merchant ? 'المتجر' : 'المنصة';
    return {
      summary: delivery
        ? 'التوصيل المجاني يتطلب سياسة تمويل توصيل معتمدة وميزانية متاحة. حفظ قسيمة العرض لا ينشئ هذا التمويل.'
        : known
          ? `يتحمل ${payer} تكلفة خصم المنتجات افتراضياً. تُطبّق المشاركة فقط وفق اتفاقية معتمدة تطابق العرض والفرع عند تأكيد الطلب.`
          : 'تُحدَّد مسؤولية تمويل الخصم وفق مصدر العرض واتفاقيات الفرع المعتمدة عند تأكيد الطلب.',
      changeNotice: editing && !delivery
        ? `تعديل محتوى العرض أو شروطه قد يُبطل مطابقة اتفاقية المشاركة الحالية. عند غياب مشاركة مطابقة يتحمل ${known ? payer : 'مصدر العرض'} كامل الخصم. راجع اتفاقيات الفرع وجدّد الموافقة على المشاركة بعد التعديل.`
        : 'حفظ العرض أو تفعيله لا ينشئ اتفاقية مشاركة جديدة ولا يمنح موافقة على تمويل مشترك.',
    };
  }
  return { describe };
});
