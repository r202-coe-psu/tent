def remote=[:]
remote.name = 'binhla'
remote.host = 'binhla2.importstar.dev'
remote.allowAnyHosts = true

pipeline {
    agent {
        docker {
            image 'node:24-slim'
        }
    }
    environment {
        BINHLA_CREDS=credentials('binhla2')           // Credential for production server
        WEB_IMAGE_NAME = 'frontend'                 // Name of your Docker image
        PROJECT_NAME = 'tent'                       // Project namespace (corresponds to docker-compose.staging.yml prefix)
        PRODUCTION_SERVER = 'binhla2.importstar.dev'   // Production server hostname or IP
        PROJECT_PATH = '/home/projects/tent'        // Deploy path on server
        WEB_BUILD_PATH = './frontend'               // Path to build frontend
    }
    stages {
        stage('Setup System (Install PNPM and Rsync)') {
            steps {
                sh '''
                echo "Installing rsync and ssh client..."
                apt-get update && apt-get install -y rsync openssh-client

                echo "Installing pnpm globally..."
                npm install -g pnpm
                pnpm --version
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                cd frontend
                pnpm install --frozen-lockfile
                '''
            }
        }

        stage('Run Frontend Dependency Audit') {
            steps {
                sh '''
                cd frontend
                pnpm audit || true
                '''
            }
        }

        stage('Lint and Formatting Check') {
            steps {
                sh '''
                cd frontend
                pnpm lint
                '''
            }
        }

        stage('Type Check') {
            steps {
                sh '''
                cd frontend
                pnpm check
                '''
            }
        }

        stage('Run Unit Tests') {
            steps {
                sh '''
                cd frontend
                pnpm test
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh 'docker build -t ${PROJECT_NAME}/${WEB_IMAGE_NAME} -f ${WEB_BUILD_PATH}/Dockerfile.prod ${WEB_BUILD_PATH}'
                sh 'docker save ${PROJECT_NAME}/${WEB_IMAGE_NAME} > ${WEB_IMAGE_NAME}.tar'
            }
        }

        stage('Copy image to server') {
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'binhla2-secret', keyFileVariable: 'SSH_KEY')]) {
                    sh 'rsync -avz -e "ssh -p 20222 -i $SSH_KEY" ${WEB_IMAGE_NAME}.tar imps@${PRODUCTION_SERVER}:/home/imps/'
                }
            }
        }

        stage('Pull to update in production server and restart service') {
            steps {
                echo 'Pulling..'
                script {
                    remote.user=env.BINHLA_CREDS_USR
                    remote.password=env.BINHLA_CREDS_PSW
                    remote.port=20222
                }
                sshCommand(remote: remote, command: "cd ${PROJECT_PATH} && git pull \
                    && docker load < /home/imps/${WEB_IMAGE_NAME}.tar \
                    && docker compose -f docker-compose.staging.yml up -d \
                    && rm /home/imps/${WEB_IMAGE_NAME}.tar"
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