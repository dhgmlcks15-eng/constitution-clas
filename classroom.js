const callbackParams = new URLSearchParams(location.hash.slice(1));
const isAuthCallback = callbackParams.has("access_token");
if (callbackParams.get("type") === "recovery") sessionStorage.setItem("class-recovery","1");
const client = supabase.createClient(classroomConfig.url, classroomConfig.publishableKey, {
  auth: {storage: sessionStorage, storageKey: "constitution-class-session",flowType:"implicit"}
});
let accountId, profile;
async function rpc(name, args = {}) {
  const {data,error} = await client.rpc("classroom_" + name,args);
  if (error) throw error;
  return data;
}
function login(role, ready) {
  const form = document.querySelector("#login"), message = form.querySelector("output");
  const student = role === "student";
  const redirectTo = location.origin + location.pathname;
  const reportError = error => { message.textContent = error.message; };
  async function enter() {
    const {data:{user},error} = await client.auth.getUser();
    if (error || !user) throw Error("로그인이 필요합니다.");
    accountId = user.id;
    profile = await rpc("profile");
    if (student && !profile) {
      const meta = user.user_metadata || {};
      await rpc("join_student",{room:form.room.value || meta.room,number:form.sid.value || meta.sid,display_name:form.displayName.value.trim() || meta.display_name || ""});
      profile = await rpc("profile");
    }
    if (!student && (!profile || profile.role === "student")) {
      if (!await rpc("join_teacher",{invite:form.invite.value || sessionStorage.getItem("teacher-invite") || ""})) throw Error("Google 계정과 교사 가입 코드를 확인하세요.");
      profile = await rpc("profile");
    }
    if (profile?.role === "admin" && !student) await rpc("join_teacher",{invite:""});
    if (!(student ? profile?.role === "student" : ["admin","teacher"].includes(profile?.role))) throw Error("해당 화면의 이용 권한이 없습니다.");
    if (student && ((form.room.value && profile.klass !== form.room.value) || (form.sid.value && profile.sid !== form.sid.value))) throw Error("등록한 학급과 학번을 확인하세요.");
    sessionStorage.removeItem("teacher-invite");
    await ready();
    form.reset(); form.hidden=true; document.querySelector("#app").hidden=false;
  }
  const checked = result => { if(result.error) throw result.error; return result.data; };
  form.onsubmit = async event => {
    event.preventDefault();
    const mode=event.submitter?.value, button=event.submitter;
    if(button) button.disabled=true;
    try {
      if (mode==="google") {
        sessionStorage.setItem("teacher-invite",form.invite.value);
        checked(await client.auth.signInWithOAuth({provider:"google",options:{redirectTo}})); return;
      }
      const email=form.email.value.trim(), password=form.password.value;
      if (mode==="reset") {
        if(!email || !form.email.reportValidity()) throw Error("가입 이메일을 입력하세요.");
        checked(await client.auth.resetPasswordForEmail(email,{redirectTo}));
        message.textContent="가입 이메일의 재설정 링크를 여세요."; return;
      }
      if (mode==="signup") {
        if(!await rpc("open_room",{room:form.room.value})) throw Error("교사가 발급한 학급 코드를 확인하세요.");
        if(!form.displayName.value.trim()) throw Error("이름을 입력하세요.");
        const data=checked(await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo,data:{room:form.room.value,sid:form.sid.value,display_name:form.displayName.value.trim()}}}));
        if (!data.session) {message.textContent="이메일 인증 후 같은 학급 코드와 학번으로 로그인하세요.";return;}
      } else checked(await client.auth.signInWithPassword({email,password}));
      await enter();
    } catch(error){reportError(error);} finally {if(button) button.disabled=false;}
  };
  const recovery=document.querySelector("#recovery");
  recovery.onsubmit=async event=>{
    event.preventDefault();
    try {checked(await client.auth.updateUser({password:recovery.newPassword.value})); await client.auth.signOut({scope:"local"}); location.replace(redirectTo);}
    catch(error){recovery.querySelector("output").textContent=error.message;}
  };
  client.auth.onAuthStateChange((event,session)=>{
    if(event==="PASSWORD_RECOVERY") sessionStorage.setItem("class-recovery","1");
    if (!session || !["INITIAL_SESSION","PASSWORD_RECOVERY","SIGNED_IN"].includes(event)) return;
    if(sessionStorage.getItem("class-recovery")) {form.hidden=true; recovery.hidden=false;}
  });
  recovery.addEventListener("submit",()=>sessionStorage.removeItem("class-recovery"));
  if(isAuthCallback) {
    client.auth.getSession().then(async result=>{
      if(result.error) throw result.error;
      await new Promise(resolve=>setTimeout(resolve,100));
      if (!recovery.hidden) return;
      if(result.data.session) await enter();
    }).catch(reportError);
  }
  document.querySelector("#logout").onclick=async()=>{await client.auth.signOut({scope:"local"});location.replace(redirectTo);};
}
