const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Service Account Credentials
const serviceAccount = {
  "type": "service_account",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "client_id": "107050843510727225693",
  "token_uri": "https://oauth2.googleapis.com/token",
  "project_id": "markendetektive-895f7",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCl+L/r90goGL67\nwe0AoAAY5CNmJjwlT0PLVECvhCVCSB1H/RbsMnIQeCIvp/Ps4Vk3RPzzZAo86gza\nptXVBCBdWvL+3TSs7MFRIFtjZJq3S8VipGEZkQdWD5hx84LmeCIZpih6VGtka4yu\nKDNKSrYKCgoPZUDv3PyEzne3Gd1gyBw9eNeFbvy+YKg/6B/1QFXF5/AQKZtIRQAS\ng6ww/DheQNrrswOjkWfd4XI5amHTMcuZC2uUJKMq7VzwTJm77/nULgBL+bVtsuEZ\nDIRLaOE0jEDNIUQhlgqWn5c0VAsMsOmOjeq7wo7mUQG7eg0tZffmmuaOgsJ0FBRs\nWoti+UpxAgMBAAECggEABNWjGYeBdZGK9MMoWS1P82mp0k7oz5loeyLAI5ywzSZ2\nm+M2aLjrc6lcLZEx3MOPqrl6uMhAOBgFOdVEQ0k0fCOrElt1LlhTJT7RCqsiipZN\ncJsjLPB5izs3EJKsTHRRYffiE/YjjrBHT8dh/xcACHjUZDBp3NLOFDxDZnT9atU9\nVR8l485z/Yk9gfzfOBwp8wcFbyPodJXwPTzd6uRclBsaxSWNQSMsV/DjkYb2NFkM\ngrOFkIXS+KpWqexUvJazgmxrnn4AljghgQaN037v/S0E4uUJz2qqbW56Mput8IwQ\nenPL499kfAYm5qjtGhtmQN0k/gas7rAppGqFH3V2BQKBgQDixuTaMWAIpfTTG60e\nkB0JERR8sGdQtBwMbmiIcbiXEJvwCXmltJ2jOOdhLd8EVqp0jCOjCKuNNJtHXYFi\niZ6UsiVXp8NyyGKmCepGPGoEaEx+EFbK5I87oKsP0U3pg67pi8yFqBRjvrvkh+2F\nd07zFsl/QupT5qM1iWhoXyIj8wKBgQC7W/YmgO+8LS0RMD+r1zT+OzMjKN2Rc8nl\nq7xPGCLYn+QYlCI/ZmEhbW11sxmu2DhfiEZKFL2t98EThtwGIEoj8V1FawBXRIem\n2xg0ZYXWetkqJDGA0jfGxHwFbk4R8vKTL1/bZh1szv10htlm/G0QTylCZPw1grM0\n5vJ3gHoFCwKBgAyIfYFplSslMOCx+OFliZVEsmMpxKv7KEmvmGtiDZebvWKIw4Za\n8xNgQ7llNZwhxg3m6NlL019cdvB8xHfTr0X8in/Lr8uaM4mFpsL2980Cjqew83sH\nIrti59FZ+fpb4sDZjxYb8fSJSA0bTg9ARsa8japQ4m58oqyEyZZrG5HtAoGBAKJf\nf4M9CQdfa4hS9Uta1i1iZt4Yw3UUESx/WlJ9y21LnKWEc+3YL2OF73AqyJ5T+v8o\nHiqDsSM87VKb9MFGaJqfykKoCgKXfKypgl+egJAxpVU1SsWm6fnUPNuEDhrWH05Z\np0yAQg4TkWrUl0L+jxKsWEiXNlC1tdOqNwZEDPujAoGBANKEm/5Q95bxqxXlGECb\nBMH8Ue1xmFi8xMDm3Spa4YGYphEqDORoOYepCumREoavGyqPOt62Y8QRuPH+3LZ9\nCnvii0VH6vGSjTXHDT0UMqyqoAj3VFyAO5M7kKOM2mEwJlxoBf+xkGzjstHA+7sj\nEUA2UhOIRKL8SVpgmnzjQYmw\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-boyte@markendetektive-895f7.iam.gserviceaccount.com",
  "private_key_id": "ac76b41301470c85843f19947a8f7ac46147cadb",
  "universe_domain": "googleapis.com",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-boyte%40markendetektive-895f7.iam.gserviceaccount.com",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs"
};

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7'
});

const db = admin.firestore();

async function analyzeFirestoreSchema() {
  console.log('🔍 Analyzing Firestore Database Schema...\n');
  
  const schema = {
    projectId: 'markendetektive-895f7',
    analyzedAt: new Date().toISOString(),
    collections: {}
  };

  try {
    // Get all collections
    const collections = await db.listCollections();
    console.log(`📁 Found ${collections.length} collections\n`);

    for (const collection of collections) {
      const collectionId = collection.id;
      console.log(`\n📋 Analyzing collection: ${collectionId}`);
      
      schema.collections[collectionId] = {
        id: collectionId,
        documentCount: 0,
        sampleDocuments: [],
        fieldTypes: {},
        subCollections: []
      };

      try {
        // Get sample documents (first 3 to avoid complexity)
        const snapshot = await collection.limit(3).get();
        schema.collections[collectionId].documentCount = snapshot.size;
        
        if (!snapshot.empty) {
          snapshot.forEach((doc, index) => {
            try {
              const data = doc.data();
              
              // Only store first 2 documents as samples
              if (index < 2) {
                schema.collections[collectionId].sampleDocuments.push({
                  id: doc.id,
                  data: data
                });
              }

              // Analyze field types with error handling
              analyzeFieldTypes(data, schema.collections[collectionId].fieldTypes);
            } catch (docError) {
              console.warn(`   ⚠️  Skipping document ${doc.id} due to complexity`);
            }
          });

          // Check for subcollections in first document
          try {
            if (snapshot.docs.length > 0) {
              const firstDoc = snapshot.docs[0];
              const subCollections = await firstDoc.ref.listCollections();
              schema.collections[collectionId].subCollections = subCollections.map(sub => sub.id);
            }
          } catch (subError) {
            console.warn(`   ⚠️  Could not analyze subcollections for ${collectionId}`);
          }
        }

        console.log(`   📊 Documents: ${schema.collections[collectionId].documentCount}`);
        console.log(`   🏷️  Fields: ${Object.keys(schema.collections[collectionId].fieldTypes).length}`);
        console.log(`   📁 Subcollections: ${schema.collections[collectionId].subCollections.length}`);

      } catch (error) {
        console.error(`   ❌ Error analyzing collection ${collectionId}:`, error.message);
        schema.collections[collectionId].error = error.message;
        // Continue with other collections
      }
    }

    // Generate detailed schema markdown
    const markdown = generateSchemaMarkdown(schema);
    
    // Save to assets folder
    const outputPath = path.join(__dirname, '..', 'assets', 'firestore-database-schema.md');
    fs.writeFileSync(outputPath, markdown, 'utf8');
    
    console.log(`\n✅ Schema analysis complete!`);
    console.log(`📄 Schema saved to: ${outputPath}`);
    
    return schema;

  } catch (error) {
    console.error('❌ Error analyzing Firestore:', error);
    throw error;
  }
}

function analyzeFieldTypes(obj, fieldTypes, prefix = '', depth = 0) {
  // Prevent deep recursion to avoid stack overflow
  if (depth > 5) return;
  
  try {
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      const type = getFieldType(value);
      
      if (!fieldTypes[fieldPath]) {
        fieldTypes[fieldPath] = {
          type: type,
          examples: [],
          count: 0
        };
      }
      
      fieldTypes[fieldPath].count++;
      
      if (fieldTypes[fieldPath].examples.length < 2) {
        // Truncate large strings and objects for examples
        let example = value;
        if (typeof value === 'string' && value.length > 100) {
          example = value.substring(0, 97) + '...';
        } else if (typeof value === 'object' && value !== null) {
          example = '[object]';
        }
        fieldTypes[fieldPath].examples.push(example);
      }

      // Recursively analyze nested objects with depth limit
      if (type === 'object' && value !== null && depth < 3) {
        analyzeFieldTypes(value, fieldTypes, fieldPath, depth + 1);
      }
    }
  } catch (error) {
    console.warn(`   ⚠️  Skipping deep analysis for prefix "${prefix}" due to complexity`);
  }
}

function getFieldType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'timestamp';
  if (value && typeof value === 'object' && value._seconds !== undefined) return 'timestamp';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function generateSchemaMarkdown(schema) {
  let markdown = `# MarkenDetektive Firestore Database Schema

## 📊 Database Overview
- **Project ID:** ${schema.projectId}
- **Analyzed At:** ${new Date(schema.analyzedAt).toLocaleString('de-DE')}
- **Total Collections:** ${Object.keys(schema.collections).length}

---

`;

  // Table of Contents
  markdown += `## 📋 Table of Contents\n`;
  for (const [collectionId] of Object.entries(schema.collections)) {
    markdown += `- [${collectionId}](#${collectionId.toLowerCase()})\n`;
  }
  markdown += `\n---\n\n`;

  // Collections details
  for (const [collectionId, collection] of Object.entries(schema.collections)) {
    markdown += `## ${collectionId}\n\n`;
    
    if (collection.error) {
      markdown += `❌ **Error:** ${collection.error}\n\n`;
      continue;
    }

    markdown += `**📊 Statistics:**\n`;
    markdown += `- Documents: ${collection.documentCount}\n`;
    markdown += `- Fields: ${Object.keys(collection.fieldTypes).length}\n`;
    markdown += `- Subcollections: ${collection.subCollections.length}\n\n`;

    if (collection.subCollections.length > 0) {
      markdown += `**📁 Subcollections:**\n`;
      collection.subCollections.forEach(sub => {
        markdown += `- \`${sub}\`\n`;
      });
      markdown += `\n`;
    }

    // Field Types
    markdown += `### Field Schema\n\n`;
    markdown += `| Field | Type | Examples |\n`;
    markdown += `|-------|------|----------|\n`;
    
    for (const [fieldPath, fieldInfo] of Object.entries(collection.fieldTypes)) {
      const examples = fieldInfo.examples.map(ex => {
        if (typeof ex === 'string' && ex.length > 50) {
          return `"${ex.substring(0, 47)}..."`;
        }
        return JSON.stringify(ex);
      }).join(', ');
      
      markdown += `| \`${fieldPath}\` | ${fieldInfo.type} | ${examples} |\n`;
    }
    markdown += `\n`;

    // TypeScript Interface
    markdown += `### TypeScript Interface\n\n`;
    markdown += `\`\`\`typescript\n`;
    markdown += `interface ${toPascalCase(collectionId)} {\n`;
    
    const rootFields = Object.entries(collection.fieldTypes)
      .filter(([path]) => !path.includes('.'))
      .sort(([a], [b]) => a.localeCompare(b));
    
    for (const [fieldPath, fieldInfo] of rootFields) {
      const tsType = mapToTypeScriptType(fieldInfo.type, fieldInfo.examples);
      const optional = fieldInfo.count < collection.documentCount ? '?' : '';
      markdown += `  ${fieldPath}${optional}: ${tsType};\n`;
    }
    
    markdown += `}\n`;
    markdown += `\`\`\`\n\n`;

    // Sample Documents
    if (collection.sampleDocuments.length > 0) {
      markdown += `### Sample Documents\n\n`;
      collection.sampleDocuments.slice(0, 2).forEach((doc, index) => {
        markdown += `#### Document ${index + 1}: \`${doc.id}\`\n`;
        markdown += `\`\`\`json\n`;
        markdown += JSON.stringify(doc.data, null, 2);
        markdown += `\n\`\`\`\n\n`;
      });
    }

    markdown += `---\n\n`;
  }

  // Database Relationships
  markdown += `## 🔗 Database Relationships\n\n`;
  markdown += `\`\`\`mermaid\n`;
  markdown += `graph TD\n`;
  for (const [collectionId, collection] of Object.entries(schema.collections)) {
    markdown += `    ${collectionId}[${collectionId}]\n`;
    collection.subCollections.forEach(sub => {
      markdown += `    ${collectionId} --> ${sub}[${sub}]\n`;
    });
  }
  markdown += `\`\`\`\n\n`;

  // Usage Examples
  markdown += `## 💡 Usage Examples\n\n`;
  markdown += `### Reading Data\n`;
  markdown += `\`\`\`typescript\n`;
  markdown += `import { collection, getDocs } from 'firebase/firestore';\n\n`;
  for (const collectionId of Object.keys(schema.collections).slice(0, 3)) {
    markdown += `// Get all ${collectionId}\n`;
    markdown += `const ${collectionId}Snapshot = await getDocs(collection(db, '${collectionId}'));\n`;
    markdown += `const ${collectionId}Data = ${collectionId}Snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));\n\n`;
  }
  markdown += `\`\`\`\n\n`;

  markdown += `### Writing Data\n`;
  markdown += `\`\`\`typescript\n`;
  markdown += `import { doc, setDoc, addDoc } from 'firebase/firestore';\n\n`;
  markdown += `// Add new document\n`;
  const firstCollection = Object.keys(schema.collections)[0];
  if (firstCollection) {
    markdown += `const docRef = await addDoc(collection(db, '${firstCollection}'), {\n`;
    markdown += `  // Your data here\n`;
    markdown += `});\n\n`;
  }
  markdown += `\`\`\`\n\n`;

  markdown += `---\n\n`;
  markdown += `*Generated by MarkenDetektive Database Schema Analyzer*\n`;
  markdown += `*Last updated: ${new Date().toLocaleString('de-DE')}*\n`;

  return markdown;
}

function toPascalCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/[-_](.)/g, (_, char) => char.toUpperCase());
}

function mapToTypeScriptType(firestoreType, examples) {
  switch (firestoreType) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return 'any[]';
    case 'timestamp': return 'Date | FirebaseTimestamp';
    case 'null': return 'null';
    case 'object': return 'object';
    default: return 'any';
  }
}

// Run the analysis
if (require.main === module) {
  analyzeFirestoreSchema()
    .then(() => {
      console.log('\n🎉 Analysis completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Analysis failed:', error);
      process.exit(1);
    });
}

module.exports = { analyzeFirestoreSchema };
