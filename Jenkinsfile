def remote=[:]
remote.name = 'binhla'
remote.host = 'binhla2.importstar.dev'
remote.allowAnyHosts = true

pipeline {
    agent {
        docker {
            image 'python:3.12-bookworm'
            args '-v dependency-check-data:/dependency-check'
        }
    }
    environment {
        BINHLA_CREDS=credentials('binhla2')           // Credential for production server
        FRONTEND_IMAGE_NAME = 'tent-frontend-image'
        IMAGE_TAG = 'latest'
        PRODUCTION_SERVER = 'binhla2.importstar.dev'   // Production server hostname or IP
        GIT_REPO_URL = 'git@github.com:r202-coe-psu/tent.git'
        GIT_BRANCH = 'develop'
        PROJECT_PATH = '/home/projects/tent'
        FRONTEND_BUILD_PATH = './frontend'
    }
    stages {
        stage('Setup System (Install Java, NPM and PNPM)') {
            steps {
                sh '''
                echo "Updating package list and installing Node, Java, and utility tools..."
                apt-get update && apt-get install -y nodejs npm openjdk-17-jdk unzip curl

                echo "Setting up JAVA_HOME..."
                export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
                echo "export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" >> ~/.profile
                echo 'export PATH=$JAVA_HOME/bin:$PATH' >> ~/.profile

                echo "Installing pnpm..."
                npm install -g pnpm@9
                echo 'export PATH=$(npm config get prefix)/bin:$PATH' >> ~/.profile
                . ~/.profile

                java -version || exit 1
                pnpm --version || exit 1
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                script {
                    sh '''
                    . ~/.profile
                    cd frontend
                    pnpm install --frozen-lockfile
                    '''
                }
            }
        }

        stage('OWASP Dependency-Check Nodejs Package Vulnerabilities') {
            steps {
                sh '''
                export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
                export PATH=$JAVA_HOME/bin:$PATH
                java -version || exit 1
                '''
                withCredentials([string(credentialsId: 'importstar-nvd-api-key', variable: 'NVD_API_KEY')]) {
                    sh '''
                    if [ ! -d "/dependency-check/dependency-check" ]; then
                        echo "Installing Dependency-Check 12.2.0..."
                        curl -fsSL https://github.com/dependency-check/DependencyCheck/releases/download/v12.2.0/dependency-check-12.2.0-release.zip -o odc.zip
                        unzip -q odc.zip -d /dependency-check
                        rm odc.zip
                    fi

                    # Run Dependency-Check scanning package.json and lockfile
                    /dependency-check/dependency-check/bin/dependency-check.sh \
                        --nvdApiKey "$NVD_API_KEY" \
                        --out . \
                        --scan 'frontend/package.json' \
                        --scan 'frontend/pnpm-lock.yaml' \
                        --data /dependency-check/data \
                        --format ALL \
                        --prettyPrint
                    '''
                }

                dependencyCheckPublisher pattern: 'dependency-check-report.xml'
            }
        }

        stage('Build Docker Image') {
            steps {
                // Ensure temporary .env exists for docker compose build configuration
                sh 'cp -n .env.example .env || true'
                sh 'docker compose -f docker-compose.staging.yml build frontend'
                sh 'docker save tent/frontend:latest > ${FRONTEND_IMAGE_NAME}.tar'
            }
        }
        stage('Copy image to server') {
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'binhla2-secret', keyFileVariable: 'SSH_KEY')]) {
                    sh 'rsync -avz -e "ssh -p 20222 -i $SSH_KEY" ${FRONTEND_IMAGE_NAME}.tar imps@${PRODUCTION_SERVER}:/home/imps/'
                }
            }
        }
        stage('Pull to update in production server and restart service') {
            steps {
                echo 'Pulling and restarting services on production...'
                script{
                    remote.user=env.BINHLA_CREDS_USR
                    remote.password=env.BINHLA_CREDS_PSW
                    remote.port=20222
                }
                sshCommand(remote: remote, command: "cd ${PROJECT_PATH} && git pull \
                    && docker load < /home/imps/${FRONTEND_IMAGE_NAME}.tar \
                    && docker compose -f docker-compose.staging.yml up -d \
                    && rm /home/imps/${FRONTEND_IMAGE_NAME}.tar"
                )
            }
        }
    }
    post {
        always {
            cleanWs(cleanWhenNotBuilt: false,
                    deleteDirs: true,
                    disableDeferredWipeout: true,
                    notFailBuild: true,
                    patterns: [[pattern: '.gitignore', type: 'INCLUDE'],
                               [pattern: '.propsfile', type: 'EXCLUDE']])
        }
    }
}