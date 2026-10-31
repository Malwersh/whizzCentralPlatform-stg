(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StaffInvitationUI=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function mount(parent,employee,context){
 const doc=context.document||document;
 const status=doc.createElement('p');status.className='invitation-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');parent.append(status);
 const state=employee.invitationStatus;if(state==='SENT')status.className='invitation-status invitation-success';
 status.textContent=({DRAFT:'لم تُرسل الدعوة بعد.',SENDING:'حالة تسليم الدعوة تحتاج مراجعة؛ لم يتأكد الإرسال.',SENT:'تم إرسال الدعوة — بانتظار تفعيل الحساب.'})[state]||'الدعوة بانتظار اعتماد الأدوار.';
 if(state!=='DRAFT'||employee.status!=='INVITED'||!employee.activationApproved||!context.canSend)return {status};
 const button=doc.createElement('button');button.type='button';button.textContent='إرسال الدعوة';parent.append(button);
 let busy=false;
 button.onclick=async()=>{
  if(busy||button.disabled)return;
  if(!context.confirm('إرسال دعوة وكلمة مرور مؤقتة إلى '+employee.email+'؟'))return;
  busy=true;button.disabled=true;button.textContent='جاري الإرسال…';status.textContent='جاري إرسال الدعوة إلى '+employee.email+'…';
  try{
   const result=await context.send(employee.employeeId);
   if(result.invitationStatus!=='SENT')throw Object.assign(Error('لم تتأكد حالة الإرسال. حدّث حالة الحساب.'),{code:'INVITATION_DELIVERY_UNCERTAIN'});
   employee.invitationStatus='SENT';status.className='invitation-status invitation-success';button.textContent='تم إرسال الدعوة';status.textContent='تم إرسال الدعوة إلى '+employee.email+' — بانتظار التفعيل.';
  }catch(error){
   status.textContent=error.message||'تعذر إرسال الدعوة.';status.className='invitation-status invitation-error';
   if(error.code==='REAUTH_REQUIRED'){
    button.textContent='يتطلب تسجيل دخول جديد';
    const login=doc.createElement('button');login.type='button';login.textContent='تسجيل الدخول لتأكيد الإرسال';login.onclick=context.reauthenticate;parent.append(login);
   }else{
    button.textContent='لم يتأكد إرسال الدعوة';
    const refresh=doc.createElement('button');refresh.type='button';refresh.textContent='تحديث حالة الدعوة';refresh.onclick=context.refresh;parent.append(refresh);
   }
  }finally{busy=false;}
 };
 return {status,button};
}
return {mount};
});
