#!/bin/bash
aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-1_Mnrmklxro \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=64f894a8-a001-70fc-ddbd-3ff0dd55c86c,PASSWORD=Moh@1985 \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json
