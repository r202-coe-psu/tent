from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017")
db = client["tent"]
doc = db.public_shelters.find_one({"shelter_code": "SH004"})
print(doc.get("contact"))
print(doc.get("key_personnel"))
