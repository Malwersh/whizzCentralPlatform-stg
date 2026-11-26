import copy
import json
import unittest
from pathlib import Path
from verify_wallet_identity import verify


class WalletIdentityPreflight(unittest.TestCase):
    def setUp(self):
        self.bindings = json.loads((Path(__file__).parent / 'wallet-identity-bindings.json').read_text())

    def read(self, *args):
        if args[0] == 'sts':
            return {'Account': '746727375268'}
        if args[1] == 'list-user-pools':
            return {'UserPools': [{'Id': i['poolId'], 'Name': i['poolName']} for i in self.bindings['identities'].values()]}
        item = next(i for i in self.bindings['identities'].values() if i['poolId'] == args[3])
        return {'UserPoolClients': [{'ClientId': item['clientId'], 'ClientName': item['clientName'], 'UserPoolId': item['poolId']}]}

    def test_verified(self):
        self.assertEqual(verify(self.bindings, self.read)['identitiesVerified'], 4)

    def test_wrong_account(self):
        with self.assertRaises(ValueError):
            verify(self.bindings, lambda *a: {'Account': '699561669180'})

    def test_missing_role(self):
        del self.bindings['identities']['merchant']
        with self.assertRaises(ValueError):
            verify(self.bindings, self.read)

    def test_shared_pool_or_client(self):
        for key in ('poolId', 'clientId'):
            bindings = copy.deepcopy(self.bindings)
            bindings['identities']['driver'][key] = bindings['identities']['admin'][key]
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify(bindings, self.read)

    def test_foreign_pool(self):
        bindings = copy.deepcopy(self.bindings)
        bindings['identities']['driver']['poolId'] = 'us-east-1_foreign'
        with self.assertRaises(ValueError):
            verify(bindings, self.read)

    def test_wrong_client(self):
        bindings = copy.deepcopy(self.bindings)
        bindings['identities']['customer']['clientId'] = 'otherclient'
        with self.assertRaises(ValueError):
            verify(bindings, self.read)


if __name__ == '__main__':
    unittest.main()
