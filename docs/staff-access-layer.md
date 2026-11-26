# Staging staff access layer

## Implemented foundation

The standalone `backend/staff-service` verifies Cognito access tokens against the central Staging user pool and client. Each request checks the live employee record and Cognito enabled state. Employee profiles support multiple roles, regional scope, approval limit, active/suspended state and version.

The catalog contains support, driver, merchant, operations, regions, promotions, finance, audit and staff administration roles. The protected bootstrap role preserves the existing administrator during migration and cannot be assigned through the API.

Role changes require a recent login, a reason, a current profile version and a different approver. Neither the requester nor the employee being edited may approve. Approval rechecks the requester's current permission and original version. Atomic conditions guard both actors, the target and the pending request; the audit record is committed in the same transaction. Requests expire after one hour. Successful changes trigger Cognito global sign-out; the response reports failure to revoke sessions rather than hiding it.

The staff API reads regions from `WizzCentral_Regions` and validates submitted region IDs. It cannot write regions, wallet data or other application tables. The new table uses encryption, point-in-time recovery and retention. The Arabic staff page supports role selection, named regions and reviewing proposed changes.

## Migration remains required

The Staging wallet authorizer now enforces live employee records and exact financial permissions. Support, driver, merchant and other legacy endpoints still require migration. Legacy browser IAM access also remains. Do not grant new employees the legacy `admins` group. Hiding a page is not authorization.

Before activating new staff accounts:

1. Existing administrator and support profiles have been seeded without changing their Cognito groups.
2. Invitation preparation, independent role approval, explicit email delivery and password/TOTP activation are implemented. Disabling workflows outside the migrated services still require work. Durable session revocation retries are implemented.
3. The independent initial approver was prepared through a one-time audited bootstrap, with the identity, three approval roles and 100,000 IQD ceiling explicitly selected by the user. The account remains INVITED and delivery DRAFT; no invitation email has been sent.
4. Route legacy protected operations through APIs that check the staff permission and actual resource region, including transaction-time actor guards.
5. Financial reads/writes now use the staff policy. Platform transfer and manual top-up approvals enforce the individual ceiling. Platform transfers and settings changes atomically guard actor versions, including the requester version recorded at proposal time.
6. Remove legacy direct browser write permissions only after integration tests prove the replacement works.
7. Test with independent real accounts, including attempts to bypass UI restrictions, stale sessions, self approval and concurrent suspension.

Staff-role definitions are currently version-controlled. A custom role editor and separately approved role-definition changes are not implemented. The approval-limit field now constrains platform transfer and manual top-up approvals.

## Checks

`node --test backend/staff-service/test/*.cjs` tests permissions, region scope, role validation, disabled identities, recent authentication, self-change/self-approval restrictions and transaction guards.

`sam validate --lint` and `sam build` validate/package the standalone service. Deployment must use the Staging AWS account/profile; existing production resources are outside scope.

## Deployment status

The independent stack `staging-wizz-staff-service` is deployed in account `699561669180`, region `us-east-1`. API: `https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging`. An unauthenticated HTTP request to `/staff/me` was verified to return 401. The user confirmed authenticated staff listing in the browser. Maker/checker acceptance with two independent accounts remains required. The frontend deployment is Amplify Staging job 32.

## Continuation: audit, revocation and MFA

Independent approvers can reject proposals with a reason. The Arabic staff page shows audit records and rejected statuses. Role approval atomically writes a durable `REVOCATIONS` item; immediate Cognito sign-out is attempted and a one-minute scheduled worker retries failures. Worker tests verify that failed requests are retained.

Cognito TOTP is optional during migration. `/pages/account-security.html` lets a signed-in employee associate and verify an authenticator, then set their MFA preference and sign out. The manual secret remains only in the displayed input and is cleared on success or page exit. The login page handles `SOFTWARE_TOKEN_MFA` both after normal authentication and after a temporary password change; tokens are saved only after final authentication success. No new employee invitation has been sent. The pool is optional for existing users, while newly provisioned employee records require TOTP.

This follows the [Cognito TOTP flow](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html). Invitation/activation is implemented; server-side enforcement across the remaining nonfinancial legacy endpoints remains unfinished. The security/audit frontend is Amplify Staging job 33.

## Invitation and financial migration acceptance

`POST /staff/invitations` creates a Cognito user with `SUPPRESS`, records a PENDING profile with no permissions, and proposes the requested roles for an independent reviewer. Existing Cognito users cannot be adopted automatically. Email claims prevent simultaneous account creation. A partial provisioning failure leaves a blocked claim for operator review instead of deleting/adopting accounts automatically.

Approval yields INVITED, not ACTIVE, for accounts that have not completed activation. Only an explicit authenticated `POST /staff/invitations/send` sends Cognito email. An uncertain delivery stays SENDING and is not automatically resent. The design uses the [Cognito AdminCreateUser contract](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html).

`POST /staff/enrollment/finish` checks the account's preapproved state, CONFIRMED Cognito password state and enrolled software MFA. It activates only the existing assignment and advances the minimum authentication time. The pre-enrollment JWT cannot use staff or financial endpoints; the user must sign in again.

Financial authorization reads the employee consistently on each request (gateway cache is disabled), checks Cognito enabled/MFA state and the intended app client/access-token type, and maps operations to separate read/request/approve/settings permissions. New employees receive no legacy Cognito admin/finance group. The finance page reads owner names through a protected server API instead of browser DynamoDB permissions. Legacy single-step funding/sandbox configuration writes remain bootstrap-only until their independent change workflows are migrated.

The initial approver has staff_approver, finance_approver and finance_settings_approver roles, not requester or staff-manager permissions. Their record is staged; real acceptance of invitation delivery, activation and independent approval remains to be performed. Current automated checks: 117 Node tests plus 6 authorizer policy tests. No operational wallet balances were changed.

## Default AWS employee-role hardening

Review of the actual Staging authenticated IAM role found `cognito-identity:*` and `cognito-sync:*` on all resources. These management permissions were removed from `whizz-centralplatform-staging-auth` and the source CloudFormation template. The prior inline policy was backed up locally. No attached managed policies were present. The legacy admin data role and identity-role mappings were left unchanged.

The browser uses the enhanced Cognito identity flow; [GetCredentialsForIdentity does not use IAM permissions to authorize requests](https://docs.aws.amazon.com/cognitoidentity/latest/APIReference/API_GetCredentialsForIdentity.html). Granting identity-administration actions to employees is therefore unnecessary.

Invitation frontend deployment: Amplify Staging job 36, SUCCEED. Account preparation verified: INVITED, DRAFT, mandatory MFA, three requested approval roles, 100,000 IQD ceiling, no legacy Cognito groups. Actual invitation delivery and activation remain pending an explicit send from the platform.

## Invitation feedback correction

The reported failed send was confirmed in CloudWatch as REAUTH_REQUIRED; the employee record remained DRAFT with no delivery claim. The recent-login guard rejected the request before Cognito email submission. CORS preflight for the send endpoint was verified to succeed.

The invitation UI now shows progress and errors next to the employee. Recent-login denial offers an explicit login action that clears app tokens and returns to the staff page after password/TOTP authentication. A confirmed SENT response permanently changes that button to a disabled sent state without depending on reloading the roster. Uncertain delivery instead offers read-only status refresh and never retries mail automatically. Five regression tests cover these cases and duplicate/cancelled clicks.

### Driver manager access (2026-10-12)
Driver-only accounts land on `drivers.html`. Navigation reads live staff permissions. The staff API now provides scoped driver listing and audited, conditional profile edits; it verifies both the original and selected work regions. Driver edits atomically guard the employee version and the driver timestamp. `driver_manager` cannot change approval status or access document/authentication material. General dashboard and unrelated legacy pages are excluded for these accounts. Approval/suspension/document workflows for non-bootstrap reviewers remain a separate migration; no legacy IAM role is granted to enable them.
